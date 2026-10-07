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

## HTML report

- **One self-contained page, no scripts, no external fonts or styles.** It opens from disk, and a report that loaded Google Fonts would trip LL-01 itself.
- **Written to `.legal-lint/report.html` in the project, with a `.gitignore` of `*` in that folder.** The report quotes snippets, so it should not be committed by accident; the repo index also skips the folder, so a re-scan never reports the report.
- **Every rule that ran is listed, including "Nothing found" and "Not applicable".** The owner sees what was checked, not only what failed. To support this, a rule run now carries the rule name.

## MCP server

- **MCP TypeScript SDK v2 (`@modelcontextprotocol/server`), not v1 (`@modelcontextprotocol/sdk`).** v2 is the stable line; v1 is legacy. It still negotiates the 2025 protocol that Claude Code and Cursor speak; a test checks 2025-06-18 and 2025-11-25 over real stdio.
- **Findings are returned in full, not trimmed to the top few.** Owner's decision on 2026-10-07, replacing the brief's "top findings with a count of the rest". Only judgment material over 2,000 characters is cut, marked `truncated`, because the agent can open the file.
- **Every result is `structuredContent` plus the same JSON as a text block.** Some clients show the model only the text.
- **Every tool takes an optional `path`, defaulting to the server's working directory.** Claude Code starts servers in the project; other clients may not.
- **Scan tools write the HTML report and return its path, so they are not marked read-only.** They are marked idempotent and non-destructive.
- **`answer_judgment` re-scans, and refuses an answer whose `contentHash` no longer matches.** An answer is never stored against material the agent did not read. It stores `answeredBy: "agent"` and a reason, so the owner can review the call in the config file.
- **Added `answer_intake`, which the brief did not list.** Without it a `needs_intake` finding is a dead end for the agent. Its description says to use only the user's own answers and never to guess.
- **Pre-flight matches whole words against each rule's topics, ignoring a trailing plural "s", and shows which topic matched.** Phrases that only look like a topic (`notTopics`: "font size", "Font Awesome", "email field") are ignored. Topics were tuned against a table of phrases in the tests: added "stripe" and "uploads"; removed "icons", "theme", "posts" and "storage", which matched unrelated work.
- **Pre-flight returns the rule's goal, its "done when" checks and owner steps, not the full steps.** `get_fix_guidance` gives the steps; pre-flight stays short and adds no new legal text.
- **`scan_url` through MCP reads intake from the project at `path`, not the server's working directory, and allows localhost.** It runs on the user's own machine, usually against their own preview. The hosted API blocks private addresses; local scans do not need to.
- **The MCP SDK is loaded only by the `mcp` command,** so the scan commands start as fast as before.
- **Licence check added in milestone 5;** keyed and keyless MCP tests live in `tests/mcp-licence.test.ts`.
- **Milestone 3 was skipped at the owner's request,** so the crawler does not read robots.txt yet.

## Licence and hosted API

- **The server records and the client judges.** The API returns a raw capture and the CLI runs the rules with local intake and judgments, so only the URL leaves the machine.
- **Public URLs go to the hosted scanner; localhost and private addresses always run locally, and `--local` forces it.** The hosted scanner refuses private addresses by design.
- **The key lives in `LEGAL_LINT_KEY` or `~/.legal-lint/key`, never `legal-lint.config.json`**, which is committed. A config that still has `licenceKey` is refused with directions.
- **24-hour cache, 7-day grace only when the API is unreachable (network, timeout, 5xx, 429).** A definite invalid answer stops the tool at once and clears the cache.
- **The MCP server starts and lists its tools without a key, and each call returns the licence message,** so the agent can tell the user what to do instead of seeing a broken server.
- **Google Cloud Run in us-central1 with request-based billing, max 1 instance, 1 vCPU, 2 GiB, plus Firestore's default database.** Chosen over Fly.io (no free tier) and Render (512 MB, ephemeral disk) to stay inside the free quota; the owner adds a card and a $1 budget alert.
- **A hard cap of 1,500 scans a month for the whole service, and a 40 s budget for starting pages (15 s per page).** Worst case that is half the free compute quota; the budget alert only emails.
- **Each hosted scan also has a hard 60 s deadline (`SCAN_DEADLINE_MS`) that closes its browser context.** The 40 s budget only stops new pages; without the deadline a page that freezes its main thread would hold a scan slot until the instance restarts. Found in the final review.
- **A key that hit its hourly or daily limit, and the monthly cap, are remembered in memory until the window ends.** Repeats are refused without Firestore reads or a queue place, so a busy over-limit key cannot use up the free read quota or crowd out other users. A key revoked during that window still gets 429 instead of 401 until it ends. Found in the final review.
- **Scan results are gzipped, and each page's HTML (1,000,000 characters) and text (300,000) are cut to a limit.** Outbound traffic beyond Cloud Run's free allowance is billed, and one huge page could otherwise make every scan expensive. A cut page could, rarely, hide a finding; a missed finding costs less than a bill. Found in the final review.
- **Per-IP limits are in memory,** which is correct with one instance. The client IP is the entry `TRUSTED_PROXY_HOPS` from the right of X-Forwarded-For, to be confirmed after the first deploy.
- **Keys are `ll_` plus 32 base62 characters; Firestore keeps only the SHA-256 and the first 8 characters.** A leaked database does not leak working keys.
- **A scan counts against the limits when Chromium is about to start, including failed loads.** The compute is spent either way. A refused URL does not count.
- **SSRF has three layers:** an input check, an in-process egress proxy that resolves names itself and connects to the checked address (defeating DNS rebinding), and Chromium flags plus Playwright's forced `<-loopback>` proxying. Only public unicast addresses on ports 80 and 443 are allowed.
- **Playwright adds `<-loopback>` to Chromium's proxy bypass list itself** (checked in playwright-core 1.63.0), so `CHROMIUM_ARGS` only disables QUIC and non-proxied WebRTC. A test proves loopback goes through the proxy.
- **The image is Node slim plus Chromium's headless shell**, aiming to fit Artifact Registry's 0.5 GB free storage. A cleanup policy keeps one image. A test fails if the deploy script loosens the limits or the image's package versions drift from package.json.
- **The API bundle imports core through subpaths (`@legal-lint/core/crawler`, `/remote`, `/address`)** so it does not pull in the TypeScript compiler.
- **Tests run licensed by default** through a setup file that writes a fresh cache to a temporary home and points the API URL at a dead port. Gate tests build their own homes.
- **The Firestore store shares the memory store's contract tests and runs them only under the emulator.** In milestone 5 they ran and passed against the emulator from `firebase-tools@13`, because the current firebase-tools needs Java 21 and this machine has Java 17.
- **`DEFAULT_API_URL` is empty until the first deploy.** Until then, `LEGAL_LINT_API_URL` is required for activation and remote scans.
- **`@hono/node-server` is also a root dev dependency,** because the end-to-end test in `tests/` serves the real API app on a local port.

## Tooling

- **pnpm 10.34.6, pinned in `packageManager`.** The installed corepack cannot run pnpm 12.
- **TypeScript 6.0.3 for the compiler API.** TypeScript 7's JavaScript API is still published as `unstable`. Syntax trees only (`createSourceFile`), no Program or type checker, and no ts-morph, because nothing needs type information.
- **Playwright is an optional dependency of the CLI**, external to the bundle and loaded with a dynamic import, so `npx legal-lint` installs fast. URL scans print an install hint when it is missing.
- **The crawler's user agent identifies the tool:** `Mozilla/5.0 (compatible; LegalLint/<version>; +https://www.npmjs.com/package/legal-lint)`.
- **Runtime tests never touch the network.** Fixtures are served from 127.0.0.1, and every other request is still recorded but answered locally with an empty response.
- **Diagrams are Mermaid text in `docs/architecture.md`, not image files.** GitHub renders them, an agent reads them as plain text, and a change shows up in the diff. One file keeps them findable; each diagram names the file that owns its behaviour, and `tests/architecture-doc.test.ts` checks those files exist.
