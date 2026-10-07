# Decisions

One line per non-obvious choice, and why.

## Product

- **No free tier.** Without a valid licence key the tool will not run (milestone 5). This replaces the brief's keyless tier, which withheld evidence and fix guidance; decided by the owner on 2026-10-06.
- **Intake gaps become `needs_intake`, not silence.** With no config, or an unanswered question, detectors still run and their findings carry the exact intake question. That way the owner sees the risk and what to answer.
- **Only `open` findings fail the CLI (exit 1).** `needs_intake` and `needs_judgment` are questions, not problems, and exit 0. Exit 2 means the scan could not run.
- **`euUkVisitors: true` counts as yes for EU-scoped rules.** The rulebook's intake asks one combined EU/UK question, so it cannot separate a UK-only site. Flagged in LEGAL_REVIEW.md.
- **For EU rules, a country list never implies "no".** `countries` containing an EU/EEA code means yes; a list without one stays "unknown" until `euUkVisitors` is answered, because EU visitors reach most public sites anyway.
- **For US rules, a country list without the US does mean "no".** There is no dedicated US question to fall back on, so the owner's list is taken as the answer instead of asking the same question twice.
- **Added an intake field, `dmcaAgentRegistered`.** LL-05 says intake asks about Copyright Office registration, but the rulebook's intake list has no such question.
- **"Serves the US" counts as "has California visitors"** for LL-02/03/04. The intake asks countries, not states.
- **Intake is asked before judgment.** A finding that needs both shows `needs_intake` first, since the answer may make the judgment moot.
- **A rule that needs intake speaks only when it found something, or when the owner already said yes.** Otherwise every repo would get LL-05's uploads question.
- **Judgment answers live in `legal-lint.config.json` under `judgments`, keyed by finding id and a hash of the material.** They are committed and reviewable, a re-scan does not ask again, and an edited template asks again.
- **A judged "marketing" (or any "open" answer) raises the finding to high confidence.** The classification was the only doubt, and someone has now read the material.
- **`init` asks every rulebook intake question and allows skipping any of them.** A skipped answer stays unknown, never "no". `--answers <json>` covers scripted use, and existing answers are kept unless `--force` is given.
- **Revenue and user-count answers are fixed bands** (`under-1m`, `1m-26.6m`, `over-26.6m`; `under-10k`, `10k-100k`, `over-100k`), cut at the rulebook's CCPA thresholds for phase 2.
- **A third exposure label, `consequence`.** LL-04's exposure is neither a statutory maximum nor a named case.
- **`sources` and `lastReviewed` are left empty.** The rulebook has neither, and the brief says not to extend legal text from memory.

## Engine

- **`detectRuntime(site: SiteCapture)` instead of a live Playwright page.** The crawler records once and every rule is a pure function of the recording. Rules are easy to test, and the CLI and API share one crawler.
- **The crawler never clicks, types, scrolls or submits**, so everything recorded happened before consent, by construction.
- **Finding id = hash(rule id, file or page path).** Line numbers are left out so that edits elsewhere in the file don't change the id.
- **One finding per file per rule**, listing every location as evidence, so an agent fixes a file in one pass. Runtime findings are one per site (per tool for LL-03), because the same request repeats on every page.
- **The crawler follows up to 4 same-origin links from the start page** whose path or text mentions pricing, plans, billing, subscribe, DMCA, copyright, terms or legal, pricing first. LL-04 needs the pricing page; milestone 3 adds robots.txt.
- **The crawler records websockets.** Hotjar streams recordings over one. In offline tests each page mocks websockets itself, because a mocked socket emits no event.
- **A detector that throws is isolated.** Its error is shown in the report and the other rules still run.
- **Rule data (legal.yaml, fix.yaml) is imported as `?raw` text and validated with zod at load.** A broken data file fails loudly. A small tsup plugin inlines the files into the bundle.
- **Files skipped by every static rule:** `.gitignore`d paths (nested files are respected), `node_modules` and build output, files over 1 MB, tests, stories, fixtures, `test-*`/`*_test` scripts, and minified bundles. None of them reach a visitor's browser.
- **.vue/.svelte/.astro files are scanned as HTML text.** Their `<link>` and `<style>` blocks are covered; their script blocks are not parsed.

## LL-01

- **A font URL needs a scheme or a leading `//`.** That way prose like "we stopped using fonts.googleapis.com" is not read as a load.
- **In code, a bare host with no font path (for example in a CSP header) is ignored.** Only `/css`, `/css2` and `/icon` on googleapis, and `/s/` on gstatic, count.
- **`preconnect` is medium confidence.** It opens a connection that reveals the visitor's IP even when nothing is downloaded. **`dns-prefetch` is ignored**: it only resolves the name, so the visitor's IP never reaches Google.
- **A font URL in a JS string whose use we can't see is low confidence.** It becomes medium when the same file calls `document.createElement('link')`. Found while scanning real repos: a URL list in a test script produced a false finding.
- **HTML and CSS inside JS strings go through the HTML and CSS scanners.** Print windows, server-rendered pages and CSS-in-JS get the same precision as real files.
- **webfontloader is detected by its `google:` config.** It loads from Google without the host ever appearing in the source.

## LL-02

- **Classification reads names, not bodies:** the subject, the template's component and file name, the send file's path and the enclosing function. Template bodies mention "order" or "sale" too often to mean anything. Marketing words plus no transactional words means marketing. Transactional words only means transactional (skipped). Anything else is asked as a judgment. Sending in a loop over subscribers, contacts or an audience counts as a marketing signal.
- **Marketing by heuristic is medium confidence; Resend broadcasts and audiences are high.** This matches the rulebook's "Medium for marketing vs transactional".
- **Footer checks run on the rendered template plus the components it renders, one level deep.** That way a shared `<EmailFooter />` counts. Provider-hosted templates (`templateId`, `TemplateAlias`) can't be seen, so only suppression is checked for them.
- **Postal address detection is a heuristic:** a street-type pattern, a PO Box, a US state plus ZIP, or an address placeholder or variable. A real address in an unusual format may be missed and reported. The agent then adds a clearer one.
- **Suppression check:** no unsubscribe route means "missing". Otherwise the names the route writes (`unsubscribed`, `suppress…`, `opt_out`…) must appear in the send file or the files it imports. If the route writes nothing we can name, the rule stays quiet. Provider-managed unsubscribes (Resend broadcasts and audiences, SendGrid `asm`, a Postmark broadcast stream) count as handled.
- **"test" and "notification" are transactional signals.** Found scanning a real repo: an SMTP test email was being sent to judgment.

## LL-03

- **Only the rulebook's five tools** (FullStory, Hotjar, LogRocket, Clarity, PostHog). Sentry Replay and others are not covered.
- **Consent gating is recognised by name:** an `if`, ternary or `&&` whose condition mentions consent, a consent manager or an allowed/granted flag; a callback passed to a consent API or named `onAccept`/`onConsent`; an early `return` on such a condition; or a script tag with `type="text/plain"`. When in doubt it counts as gated, because a missed finding costs less than a false alarm.
- **PostHog with recording not disabled in code is medium,** because recording also depends on the project's remote settings. `disable_session_recording: true` and `opt_out_capturing_by_default: true` both silence it. At runtime only `/s/` (recordings) and the recorder script count; `/e/` events are analytics and not this rule.
- **At runtime, recording traffic means high; only the vendor script loading means medium.**

## LL-04

- **A subscription is a Stripe Checkout in `mode: 'subscription'`, a Stripe or Razorpay `subscriptions.create`, a Paddle checkout, a Lemon Squeezy checkout, or a Stripe pricing table.** Stripe Checkout without the mode is one-time payment and is ignored.
- **The renewal disclosure and the consent box are only judged when checkout UI is in the repo** (pricing, checkout, billing or paywall components, or files that start checkout). A hosted checkout link with no UI in the repo is not guessed at.
- **A disclosure needs both a renewal phrase and the word "cancel".** A consent box needs a checkbox plus agree/consent wording near terms, renewal or charges. A box that is checked by default is reported as pre-checked.
- **Online cancellation means a billing-portal session, a cancel call, `cancel_at_period_end`, a provider portal URL, or a cancel or portal route.** It does not mean `cancel_url` or `/checkout/cancel`, which are where abandoned checkouts land. A fixture caught this.
- **The runtime check needs a price with a period next to it** (`$29/mo`, `€9 per month`, or "billed annually" in the same sentence). A one-time price near the word "monthly" is not enough.

## LL-05

- **The intake decides applicability; the code decides confidence.** With "hosts uploads publicly: yes", a missing DMCA page is high confidence if upload code was found, and medium if not (text posts are user content too, and can't be detected).
- **A DMCA page is any page or content file named dmca/copyright, or any page or Markdown file mentioning a DMCA, copyright or designated agent,** so policies in `/legal` or the terms count. It needs a contact email or mailto link; placeholders don't count.
- **With a page in place, registration comes from the intake:** unanswered is a `needs_intake` finding, "no" is an open finding, and "yes" means no finding.
- **Upload detection covers the rulebook's list plus Supabase Storage, Vercel Blob and Firebase Storage**, which are common in the target stack.

## Tooling

- **pnpm 10.34.6, pinned in `packageManager`.** The installed corepack cannot run pnpm 12.
- **TypeScript 6.0.3 for the compiler API.** TypeScript 7's JavaScript API is still published as `unstable`. Syntax trees only (`createSourceFile`), no Program or type checker, and no ts-morph, because nothing needs type information.
- **Playwright is an optional dependency of the CLI**, external to the bundle and loaded with a dynamic import, so `npx legal-lint` installs fast. URL scans print an install hint when it is missing.
- **The crawler's user agent identifies the tool:** `Mozilla/5.0 (compatible; LegalLint/<version>; +https://www.npmjs.com/package/legal-lint)`.
- **Runtime tests never touch the network.** Fixtures are served from 127.0.0.1, and every other request is still recorded but answered locally with an empty response.
