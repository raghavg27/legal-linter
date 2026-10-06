# Build Legal Lint, phase 1

I'm building Legal Lint, a linter that finds legal traps in startup codebases and live sites. Think ESLint, but each rule is a law a founder breaks by accident: Google Fonts leaking visitor IPs in the EU, marketing emails with no unsubscribe link, session replay recording before consent.

`RULEBOOK.md` in this repo is the product spec. Read it fully before doing anything else. It defines 15 rules with their detection method, fix guidance, applicability conditions and exposure. This prompt covers phase 1 only: rules LL-01 to LL-05.

## Who uses this and why it shapes the design

The users are solo founders and small teams, many of them shipping apps built with AI coding tools, mostly on Next.js with Stripe, Supabase and Resend. They are not lawyers and will not read a long report.

Most of them will never run Legal Lint directly. Their coding agent (Claude Code, Cursor) will call it through an MCP server, before writing risky code and after. So the main consumer of our output is another AI agent, and the output has to be precise enough for that agent to act on: exact file and line, what was observed, what to change, and how to confirm the change worked.

Trust is the whole product. A false alarm costs more than a missed finding, because one wrong flag teaches the user to ignore the tool. When a detector is unsure, it reports lower confidence or stays silent, and every finding says when the rule would not apply.

I'm a QA/SDET engineer, so I care a lot about the fixtures. Treat this as a test-suite product: each rule is only as good as the fixtures that prove it fires when it should and stays quiet when it shouldn't.

## Three decisions that define the architecture

**Legal Lint reports and guides. It does not edit code.** There is no `fix` command. Each rule ships fix guidance, and the user's coding agent applies it. This is deliberate: the agent already knows the user's framework and conventions, and writing our own code-editing logic for every framework is the most expensive thing we could build.

**The user's source code never leaves their machine.** All repo scanning runs locally. This is a product promise I will put on the landing page, so enforce it with a test: scan a fixture with network interception on, and assert that no request body contains file contents or file paths.

**Access is gated by a licence key checked against a hosted API.** The local package calls my server to validate the key. The server also runs live-URL scans, so users don't need Chromium installed. The rules ship inside the local package, and I accept that someone determined could copy them. Don't obfuscate the code or build anti-tamper logic.

## What to build, in order

Stop after each milestone, show me what works, and wait for me before starting the next one.

**Milestone 1: rule engine and CLI.**
A `legal-lint` CLI with `scan <path>` for a repo and `scan-url <url>` for a live site. Both produce the same finding format, as readable terminal output and as JSON (`--json`). Get the engine, the rule interface, the finding format and the fixture harness right here, with LL-01 implemented end to end as the proving rule, static and runtime.

**Milestone 2: the other four MVP rules.**
LL-02 through LL-05, following the rulebook's detection notes. Add the intake config (`legal-lint.config.json`, created by `legal-lint init`, questions listed in the rulebook) and make every rule read its applicability from it. With no config, rules that depend on intake report as "needs intake answer" instead of firing.

**Milestone 3: batch URL scan.**
`legal-lint scan-urls <file>` takes a list of URLs and writes one CSV row per finding. I'll use this myself to scan about 100 recently launched startups and email founders their specific finding, which is how I'm validating demand. Make it polite: one site at a time by default, a user agent that identifies the tool, respect robots.txt, a handful of pages per site, no form submissions and no logins.

**Milestone 4: MCP server.**
A local stdio MCP server in the same package, started with `npx legal-lint mcp`, wrapping the same engine. Details in the MCP section below. No licence check yet in this milestone, so I can test it in Claude Code and Cursor first.

**Milestone 5: hosted API and licence keys.**
A small hosted service with two jobs: validate licence keys, and run URL scans on request. Then wire the gate into the MCP server and CLI. Details in the licence section below.

Not in this phase: billing and checkout, a web UI, the GitHub App, a standalone fix command, and rules LL-06 to LL-15. Design the engine so those can be added later, but don't build them or stub them out.

## Technical decisions already made

- TypeScript on Node, pnpm workspace. Packages: `core` (engine, rule interface, finding types), `rules` (one folder per rule), `cli` (CLI and MCP server, published as one npm package), `api` (the hosted service).
- Playwright for runtime checks. Record all network requests and cookies from first load, before any interaction. The runtime engine lives in `core` so the CLI can run it locally (for my batch scans) and the API can run it for users.
- Static detection should prefer parsing over regex where it matters: the TypeScript compiler API or ts-morph for JS/TS, plain text search for HTML, CSS and config. Regex alone will produce false positives on comments and strings.
- No LLM API calls and no model API key anywhere in this project. Where a rule needs judgment (LL-02: is this email marketing or transactional?), use heuristics for the obvious cases and hand the unclear ones to the host agent, as described in the MCP section.
- The official MCP TypeScript SDK. Check its current documentation before writing the server instead of relying on memory, since the SDK changes often.
- Vitest for tests.

If you think one of these is wrong for a reason you can show me, say so before building around it.

## The rule interface

Each rule lives in its own folder and exports: metadata (id, name, law citation, regions, phase, fix type), an `applies(intake)` function returning yes, no or unknown, and a `detectStatic(repo)` and/or `detectRuntime(page)` function.

Beside the code, each rule has two data files that a non-programmer can review:

- **Legal text**: trap, applies-when, exposure, source links and last-reviewed date, copied from the rulebook.
- **Fix guidance**: written for a coding agent to follow. It states the goal, the steps (with framework-specific variants where they differ, Next.js App Router and Pages Router first), what must be true afterwards so a re-scan passes, and a separate list of steps only the owner can do, such as registering a DMCA agent or confirming renewal terms. Explain why each step matters, so the agent can adapt when the repo doesn't match the expected shape.

## What a finding contains

Rule id, a stable finding id, a confidence level (high, medium, low), the evidence (file path and line range for static, request URL and timing for runtime), a two-sentence plain-language explanation, the "does not apply if" condition, the exposure line from the rulebook, and the fix type.

A finding can also have the status `needs_judgment`, carrying a specific question and the material needed to answer it (for LL-02, the email template and where it is sent from). See the MCP section for how that gets resolved.

Wording matters legally. Findings describe what was observed and the risk it creates. They never say the user "is violating" or "is non-compliant", and never promise that fixing a finding makes the product compliant. Exposure figures are always labelled as statutory maximums or as a named case, exactly as in the rulebook. Every report ends with a short line saying this is not legal advice.

## The MCP server

The agent decides when to call a tool by reading its description, so write the descriptions with care: say what the tool does and exactly when an agent should reach for it. Propose the tool list to me before building it. My starting point:

- **A pre-flight check.** The agent says what it is about to build or add ("Stripe subscriptions", "Hotjar", "newsletter signup", "image uploads") and gets back the rules that apply and what to do to stay clear of them. This is the most valuable tool, because it prevents the problem instead of reporting it. Its description should tell agents to call it before adding payments, analytics, tracking, email or SMS sending, user uploads, auth, or fonts.
- **Scan the repo.** Returns findings for the current working tree.
- **Scan a URL.** Returns runtime findings for a live or preview URL.
- **Fix guidance for a finding.** Returns the guidance file content for that rule, selected for the detected framework, plus the owner-only steps to pass on to the user.
- **Answer a judgment question.** For a `needs_judgment` finding, the agent reads the supplied material, answers the question, and the server turns that into a normal finding or drops it. Don't depend on MCP sampling for this, since client support for it is uneven.
- **Explain a rule.** Plain-language description, law citation and exposure, for when the user asks why.

After the agent applies a fix, it re-runs the repo scan to confirm the finding is gone. Say so in the fix guidance output.

Tool results should be compact structured data with short text, since they are read by a model with limited context. Return the top findings with a count of the rest when there are many.

## Licence keys and the hosted API

- The key comes from the `LEGAL_LINT_KEY` environment variable, or from the config file.
- The local package validates the key against the API and caches a valid result for 24 hours, so the tool keeps working offline and doesn't call home on every scan.
- **Without a key** (free tier): the pre-flight check, scans and rule explanations work, and findings show the rule, confidence and explanation. Evidence locations and fix guidance are withheld, with a one-line note saying a key unlocks them. I want the free tier to prove the problem is real and the paid tier to solve it.
- **With a valid key**: everything.
- The only data sent to the API is the licence key, the package version, and, for URL scans, the URL. Document this in the README in plain words.
- The API needs to run Chromium, so it must be a container-hosted service, not a serverless function. Propose a host and a simple key store, and keep the running cost low; I expect a handful of users at first.
- Keys are issued by an admin script I run by hand. No signup, payments or dashboard yet.
- Rate-limit URL scans per key, and per IP for keyless use, since each one costs me real compute.
- The API must refuse to scan private and internal addresses (localhost, private IP ranges, cloud metadata endpoints), including after redirects. A URL scanner that fetches whatever it is told is an open door into my own infrastructure.

## Fixtures

For each rule, create small fixture projects under `fixtures/<rule-id>/`:

- at least two that should fire (different frameworks or different ways of making the mistake)
- at least two that should not fire: one that does the right thing, and one near miss that looks like the trap but isn't (for LL-01, a self-hosted font file whose name contains "google"; for LL-02, a password reset email with no unsubscribe link; for LL-03, PostHog installed with session recording disabled)
- for each firing fixture, a `fixed` twin: the same project after the fix guidance has been followed by hand. The test scans the twin and expects no finding. This is how we prove the guidance leads to a passing scan without running an agent in the test suite.

Runtime fixtures are served from a local static server in the test, so tests never touch the network. The MCP server gets its own tests that call each tool through the SDK's client and check the result shape, in both keyed and keyless modes.

Write detectors that handle the general case. If a fixture is hard to pass, tell me why instead of special-casing it.

## How to work

- Start by reading `RULEBOOK.md`, then propose the repo layout and the TypeScript types for rule, finding and fix guidance. Wait for my go-ahead before writing the engine.
- Commit at each working step with a clear message.
- The rulebook's legal figures and dates are unverified drafts. Copy them as written and don't correct or extend them from your own knowledge; if something looks wrong, add it to `LEGAL_REVIEW.md` for the lawyer review.
- Keep a `DECISIONS.md` with one line per non-obvious choice you make and why.
- When you finish a milestone, tell me plainly what works, what you tested, and what you didn't get to or aren't sure about.
