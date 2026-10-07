# Decisions

This file has one line for each decision that is not obvious, with the reason.

## Product

- **No free tier.** If there is no valid licence key, the tool does not run (milestone 5). This replaces the keyless tier of the brief. That tier did not give evidence and fix guidance. The owner made this decision on 2026-10-06.
- **Gaps in the intake become `needs_intake`. The tool does not stay silent.** If there is no config, or a question has no answer, the detectors still run. Their findings contain the exact intake question. Thus the owner sees the risk and the question to answer.
- **Only `open` findings make the CLI fail (exit 1).** `needs_intake` and `needs_judgment` are questions, not problems. They give exit 0. Exit 2 means that the scan could not run.
- **`euUkVisitors: true` counts as yes for rules about the EU.** The intake of the rulebook asks one question for the EU and the UK together. Thus it cannot identify a site that has visitors only from the UK. This item is in LEGAL_REVIEW.md.
- **For EU rules, a country list never means "no".** If `countries` contains an EU/EEA code, the answer is yes. If the list does not contain one, the answer stays "unknown" until `euUkVisitors` has an answer. The reason: EU visitors come to most public sites.
- **For US rules, a country list without the US means "no".** There is no separate US question. Thus the tool uses the list of the owner as the answer, and does not ask the same question two times.
- **We added an intake field, `dmcaAgentRegistered`.** LL-05 says that the intake asks about the registration at the Copyright Office. But the intake list of the rulebook does not have this question.
- **"Serves the US" counts as "has visitors from California"** for LL-02, LL-03 and LL-04. The intake asks for countries, not states.
- **The tool asks the intake question before the judgment question.** If a finding needs the two answers, it shows `needs_intake` first, because the intake answer can make the judgment unnecessary.
- **A rule that needs intake shows a finding only when it found something, or when the owner already answered yes.** If not, each repo gets the uploads question of LL-05.
- **Judgment answers are in `legal-lint.config.json` under `judgments`. Their keys are the finding id and a hash of the material.** The answers are committed and persons can review them. A re-scan does not ask again. If a person edits a template, the tool asks again.
- **A "marketing" answer (or each answer with the outcome "open") increases the finding to high confidence.** The classification was the only doubt, and a person or agent has now read the material.
- **`init` asks each intake question of the rulebook, and lets you skip each question.** A question that you skip stays unknown. It never becomes "no". `--answers <json>` is for scripts. `init` keeps the answers that exist, unless you use `--force`.
- **The answers for revenue and user count are fixed bands** (`under-1m`, `1m-26.6m`, `over-26.6m`; `under-10k`, `10k-100k`, `over-100k`). The limits of the bands are the CCPA thresholds of the rulebook for phase 2.
- **A third exposure label, `consequence`.** The exposure of LL-04 is not a statutory maximum and not a named case.
- **`sources` and `lastReviewed` are empty.** The rulebook does not have them, and the brief says that we must not add to legal text from memory.

## Engine

- **`detectRuntime(site: SiteCapture)`, not a live Playwright page.** The crawler records one time. Each rule is a pure function of the recording. Thus the rules are easy to test, and the CLI and the API use the same crawler.
- **The crawler never clicks, types, scrolls or submits.** Thus all the data that it records occurred before consent. This is true by design.
- **Finding id = hash(rule id, file or page path).** The id does not include line numbers. Thus edits at other locations in the file do not change the id.
- **One finding for each file and each rule.** The finding lists each location as evidence. Thus an agent fixes a file in one pass. Runtime findings are one for each site (one for each tool for LL-03), because the same request occurs again on each page.
- **The crawler follows a maximum of 4 links on the same origin from the start page.** The path or text of each link must contain pricing, plans, billing, subscribe, DMCA, copyright, terms or legal. Pricing comes first. LL-04 needs the pricing page. Milestone 3 adds robots.txt.
- **The crawler records websockets.** Hotjar sends recordings through a websocket. In offline tests, each page makes its own mock websockets, because a mock socket does not send an event.
- **If a detector throws an error, the error stays in that detector.** The report shows the error, and the other rules continue to run.
- **The rule data (legal.yaml, fix.yaml) is imported as `?raw` text. zod validates it at load time.** Thus a data file with an error causes a clear failure. A small tsup plugin puts the files into the bundle.
- **No static rule scans these files:** `.gitignore`d paths (the tool also obeys nested `.gitignore` files), `node_modules` and build output, files larger than 1 MB, tests, stories, fixtures, `test-*`/`*_test` scripts, and minified bundles. None of these files go to the browser of a visitor.
- **The tool scans .vue/.svelte/.astro files as HTML text.** It examines their `<link>` and `<style>` blocks. It does not parse their script blocks.

## LL-01

- **A font URL must have a scheme or a `//` at the start.** Thus the rule does not think that text such as "we stopped using fonts.googleapis.com" loads a font.
- **In code, the rule ignores a host without a font path (for example, in a CSP header).** Only `/css`, `/css2` and `/icon` on googleapis, and `/s/` on gstatic, count.
- **`preconnect` is medium confidence.** It opens a connection that shows the IP address of the visitor, also when no file downloads. **The rule ignores `dns-prefetch`.** It only resolves the name. Thus the IP address of the visitor does not go to Google.
- **A font URL in a JS string is low confidence if we cannot see how the code uses it.** It becomes medium when the same file calls `document.createElement('link')`. We found this problem when we scanned real repos: a URL list in a test script gave a false finding.
- **HTML and CSS in JS strings go through the HTML and CSS scanners.** Thus print windows, pages that the server renders and CSS-in-JS get the same precision as real files.
- **The rule finds webfontloader by its `google:` config.** webfontloader loads from Google, but the host is not in the source.

## LL-02

- **The classification reads names, not the text of the email.** It reads the subject, the component name and file name of the template, the path of the send file and the function that contains the send. The text of templates contains "order" or "sale" too frequently to be useful. Marketing words without transactional words means marketing. Only transactional words means transactional (the rule skips it). All other cases become a judgment question. A send in a loop over subscribers, contacts or an audience counts as a marketing signal.
- **Marketing that the heuristic finds is medium confidence. Resend broadcasts and audiences are high confidence.** This agrees with "Medium for marketing vs transactional" in the rulebook.
- **The footer checks examine the rendered template and the components that it renders, one level deep.** Thus a shared `<EmailFooter />` counts. The rule cannot see templates that the provider hosts (`templateId`, `TemplateAlias`). Thus it checks only the suppression for them.
- **The detection of a postal address is a heuristic.** It looks for a street-type pattern, a PO Box, a US state with a ZIP code, or an address placeholder or variable. The rule can miss a real address with an unusual format and report it. The agent then adds a clearer address.
- **The suppression check:** if there is no unsubscribe route, the result is "missing". If there is a route, the names that the route writes (`unsubscribed`, `suppress…`, `opt_out`…) must be in the send file or in the files that it imports. If the route writes no name that we can identify, the rule gives no finding. Unsubscribes that the provider manages count as correct: Resend broadcasts and audiences, SendGrid `asm`, a Postmark broadcast stream.
- **"test" and "notification" are transactional signals.** We found this when we scanned a real repo: the rule sent an SMTP test email to judgment.

## LL-03

- **Only the five tools of the rulebook** (FullStory, Hotjar, LogRocket, Clarity, PostHog). The rule does not find Sentry Replay or other tools.
- **The rule identifies a consent gate by its name.** These count as a gate:
  - an `if`, a ternary or a `&&` with a condition that refers to consent, a consent manager, or an allowed/granted flag;
  - a callback that the code gives to a consent API, or a callback with the name `onAccept`/`onConsent`;
  - an early `return` on such a condition;
  - a script tag with `type="text/plain"`.

  If the rule is not sure, it counts the code as gated, because a missed finding costs less than a false alarm.
- **PostHog is medium confidence when the code does not disable the recording,** because the recording also depends on the remote settings of the project. `disable_session_recording: true` and `opt_out_capturing_by_default: true` both stop the finding. At runtime, only `/s/` (recordings) and the recorder script count. `/e/` events are analytics and are not part of this rule.
- **At runtime, recording traffic gives high confidence. If only the script of the vendor loads, the confidence is medium.**

## LL-04

- **These items are a subscription:** a Stripe Checkout in `mode: 'subscription'`, a Stripe or Razorpay `subscriptions.create`, a Paddle checkout, a Lemon Squeezy checkout, or a Stripe pricing table. A Stripe Checkout without this mode is a one-time payment, and the rule ignores it.
- **The rule examines the renewal disclosure and the consent box only when the checkout UI is in the repo.** The checkout UI is pricing, checkout, billing or paywall components, or files that start a checkout. If the repo has only a link to a hosted checkout and no UI, the rule does not guess.
- **A disclosure must have a renewal phrase and the word "cancel".** A consent box must have a checkbox, and agree or consent text near terms, renewal or charges. If a box is checked by default, the rule reports it as pre-checked.
- **These items are online cancellation:** a billing-portal session, a cancel call, `cancel_at_period_end`, a provider portal URL, or a cancel or portal route. `cancel_url` and `/checkout/cancel` are not online cancellation. They are the pages where checkouts that the customer stops go. A fixture found this problem.
- **The runtime check needs a price with a period next to it** (`$29/mo`, `€9 per month`, or "billed annually" in the same sentence). A one-time price near the word "monthly" is not sufficient.

## LL-05

- **The intake decides the applicability. The code decides the confidence.** With "hosts uploads publicly: yes", a missing DMCA page is high confidence if the tool found upload code. If not, it is medium confidence. (Text posts are also user content, and the tool cannot detect them.)
- **A DMCA page is a page or content file with the name dmca/copyright. It is also a page or Markdown file that refers to a DMCA, copyright or designated agent.** Thus policies in `/legal` or in the terms count. The page must have a contact email or a mailto link. Placeholders do not count.
- **When the page exists, the registration comes from the intake.** No answer gives a `needs_intake` finding. "No" gives an open finding. "Yes" gives no finding.
- **The upload detection finds the list of the rulebook, and also Supabase Storage, Vercel Blob and Firebase Storage.** These are frequent in the target stack.

## HTML report

- **One self-contained page, with no scripts, and no external fonts or styles.** It opens from the disk. Also, a report that loads Google Fonts would cause an LL-01 finding.
- **The tool writes the report to `.legal-lint/report.html` in the project. The folder has a `.gitignore` with `*`.** The report contains snippets of code. Thus the folder prevents a commit of the report by accident. The repo index also skips the folder. Thus a re-scan never reports the report.
- **The report lists each rule that ran, also with "Nothing found" and "Not applicable".** The owner sees what the tool checked, not only the failures. For this function, a rule run now contains the rule name.

## MCP server

- **MCP TypeScript SDK v2 (`@modelcontextprotocol/server`), not v1 (`@modelcontextprotocol/sdk`).** v2 is the stable line. v1 is legacy. v2 still uses the 2025 protocol that Claude Code and Cursor use. A test checks 2025-06-18 and 2025-11-25 over real stdio.
- **The tools return all findings, not only the first few.** The owner made this decision on 2026-10-07. It replaces "top findings with a count of the rest" of the brief. The tool cuts only judgment material that is longer than 2,000 characters, and marks it `truncated`, because the agent can open the file.
- **Each result is `structuredContent` and the same JSON as a text block.** Some clients show only the text to the model.
- **Each tool accepts an optional `path`. The default is the working directory of the server.** Claude Code starts servers in the project. Other clients possibly do not.
- **The scan tools write the HTML report and return its path. Thus they do not have the read-only mark.** They have the marks idempotent and non-destructive.
- **`answer_judgment` scans again. It refuses an answer if the `contentHash` is different.** Thus the tool never keeps an answer for material that the agent did not read. It keeps `answeredBy: "agent"` and a reason. Thus the owner can review the decision in the config file.
- **We added `answer_intake`. The brief did not have it.** Without it, the agent cannot continue from a `needs_intake` finding. Its description tells the agent to use only the answers of the user and never to guess.
- **The pre-flight check matches full words with the topics of each rule. It ignores a plural "s" at the end, and shows the topic that matched.** It ignores phrases that only look like a topic (`notTopics`: "font size", "Font Awesome", "email field"). We adjusted the topics with a table of phrases in the tests. We added "stripe" and "uploads". We removed "icons", "theme", "posts" and "storage", because they matched work that is not related.
- **The pre-flight check returns the goal of the rule, its "done when" checks and the owner steps. It does not return the full steps.** `get_fix_guidance` gives the steps. The pre-flight check stays short and adds no new legal text.
- **Through MCP, `scan_url` reads the intake from the project at `path`, not from the working directory of the server. It accepts localhost.** It runs on the machine of the user, usually on their own preview. The hosted API blocks private addresses. Local scans do not need to block them.
- **Only the `mcp` command loads the MCP SDK.** Thus the scan commands start as fast as before.
- **We added the licence check in milestone 5.** The MCP tests with and without a key are in `tests/mcp-licence.test.ts`.
- **We did not do milestone 3, because the owner asked us not to.** Thus the crawler does not read robots.txt at this time.

## Licence and hosted API

- **The server records and the client makes the decisions.** The API returns a raw capture. The CLI runs the rules with the local intake and judgments. Thus only the URL goes out of the machine.
- **Public URLs go to the hosted scanner. Localhost and private addresses always run locally. `--local` makes all scans run locally.** The hosted scanner refuses private addresses by design.
- **The key is in `LEGAL_LINT_KEY` or `~/.legal-lint/key`. It is never in `legal-lint.config.json`**, because that file is committed. If a config still has `licenceKey`, the tool refuses it and tells the user what to do.
- **A 24-hour cache. A 7-day grace period only when the tool cannot connect to the API (network, timeout, 5xx, 429).** A clear "invalid" answer stops the tool immediately and clears the cache.
- **The MCP server starts and lists its tools without a key. Each call returns the licence message.** Thus the agent can tell the user what to do. The agent does not see a server that does not operate.
- **Google Cloud Run in us-central1 with request-based billing, a maximum of 1 instance, 1 vCPU, 2 GiB, and the default database of Firestore.** We did not select Fly.io (no free tier) or Render (512 MB, a disk that does not keep data), because we want to stay in the free quota. The owner adds a card and a $1 budget alert.
- **A hard limit of 1,500 scans each month for the full service, and a budget of 40 s to start pages (15 s for each page).** In the worst case, that is half of the free compute quota. The budget alert only sends email.
- **Each hosted scan also has a hard deadline of 60 s (`SCAN_DEADLINE_MS`). At the deadline, the scan closes its browser context.** The 40 s budget only stops new pages. Without the deadline, a page that freezes its main thread would keep a scan position until the instance restarts. We found this in the final review.
- **The API keeps in memory a key that went over its hourly or daily limit, and the monthly limit, until the window ends.** It refuses repeated requests without Firestore reads and without a queue position. Thus a busy key that is over its limit cannot use all of the free read quota or block other users. If you revoke a key during that window, it still gets 429, not 401, until the window ends. We found this in the final review.
- **Scan results are compressed with gzip. The HTML (1,000,000 characters) and the text (300,000) of each page are cut to a limit.** Outbound traffic above the free allowance of Cloud Run costs money. Without a limit, one very large page could make each scan expensive. A cut page can, rarely, hide a finding. A missed finding costs less than a bill. We found this in the final review.
- **The limits for each IP address are in memory.** This is correct with one instance. The client IP is the entry at position `TRUSTED_PROXY_HOPS` from the right of X-Forwarded-For. You must confirm this after the first deploy.
- **Keys are `ll_` and 32 base62 characters. Firestore keeps only the SHA-256 and the first 8 characters.** Thus, if a person gets a copy of the database, they do not get keys that operate.
- **A scan counts against the limits when Chromium is about to start, also when the load fails.** The compute is used in the two cases. A refused URL does not count.
- **SSRF has three layers:**
  1. An input check.
  2. An egress proxy in the process. It resolves names itself and connects to the checked address. This prevents DNS rebinding.
  3. Chromium flags, and the `<-loopback>` proxy setting that Playwright always adds.

  Only public unicast addresses on ports 80 and 443 are permitted.
- **Playwright itself adds `<-loopback>` to the proxy bypass list of Chromium** (checked in playwright-core 1.63.0). Thus `CHROMIUM_ARGS` only disables QUIC and WebRTC outside the proxy. A test proves that loopback goes through the proxy.
- **The image is Node slim and the headless shell of Chromium.** The objective is to stay in the free storage of 0.5 GB of Artifact Registry. A cleanup policy keeps one image. A test fails if the deploy script makes the limits larger, or if the package versions of the image are different from package.json.
- **The API bundle imports core through subpaths (`@legal-lint/core/crawler`, `/remote`, `/address`).** Thus the bundle does not include the TypeScript compiler.
- **By default, the tests run with a licence.** A setup file writes a new cache to a temporary home. It also sets the API URL to a port where no server runs. The gate tests make their own homes.
- **The Firestore store uses the same contract tests as the memory store. These tests run only with the emulator.** In milestone 5, they ran and passed on the emulator from `firebase-tools@13`. The reason: the current firebase-tools needs Java 21, and this machine has Java 17.
- **`DEFAULT_API_URL` is empty until the first deploy.** Until then, activation and remote scans need `LEGAL_LINT_API_URL`.
- **`@hono/node-server` is also a dev dependency at the root,** because the end-to-end test in `tests/` serves the real API app on a local port.

## Tooling

- **pnpm 10.34.6, pinned in `packageManager`.** The installed corepack cannot run pnpm 12.
- **TypeScript 6.0.3 for the compiler API.** The JavaScript API of TypeScript 7 is still published as `unstable`. We use only syntax trees (`createSourceFile`). We do not use a Program, the type checker or ts-morph, because no code needs type information.
- **Playwright is an optional dependency of the CLI.** It is not in the bundle. The CLI loads it with a dynamic import. Thus `npx legal-lint` installs fast. If Playwright is missing, URL scans tell the user how to install it.
- **The user agent of the crawler identifies the tool:** `Mozilla/5.0 (compatible; LegalLint/<version>; +https://www.npmjs.com/package/legal-lint)`.
- **Runtime tests never connect to the network.** The fixtures are served from 127.0.0.1. The crawler still records all other requests, but it answers them locally with an empty response.
- **The diagrams are Mermaid text in `docs/architecture.md`, not image files.** GitHub renders them. An agent reads them as plain text. A change shows in the diff. One file makes them easy to find. Each diagram names the file that owns its behaviour. `tests/architecture-doc.test.ts` makes sure that these files exist.
