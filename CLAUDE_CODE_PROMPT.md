# Build Legal Lint, phase 1

I am building Legal Lint. It is a linter that finds legal traps in startup codebases and live sites. It is similar to ESLint, but each rule is a law that a founder breaks by accident. Examples:

- Google Fonts send the IP addresses of visitors in the EU to Google.
- Marketing emails have no unsubscribe link.
- Session replay records before consent.

`RULEBOOK.md` in this repo is the product specification. Read all of it before you do other work. It defines 15 rules. For each rule, it gives the detection method, fix guidance, applicability conditions and exposure. This prompt is only about phase 1: rules LL-01 to LL-05.

## The users, and how they affect the design

The users are solo founders and small teams. Many of them ship apps that they build with AI coding tools. Most of the apps use Next.js with Stripe, Supabase and Resend. The users are not lawyers. They will not read a long report.

Most of them will never run Legal Lint themselves. Their coding agent (Claude Code, Cursor) will call it through an MCP server, before and after it writes risky code. Thus the main user of our output is another AI agent. The output must be sufficiently precise for that agent to act on it. It must give:

- the exact file and line,
- what the tool saw,
- what to change,
- how to make sure that the change is correct.

Trust is the full product. A false alarm costs more than a missed finding, because one incorrect flag teaches the user to ignore the tool. When a detector is not sure, it reports a lower confidence or gives no finding. Each finding tells when the rule does not apply.

I am a QA/SDET engineer. Thus the fixtures are very important to me. Think of this product as a test suite. A rule is only as good as the fixtures that prove two things: it fires when it should, and it stays quiet when it should not.

## Three decisions that define the architecture

**Legal Lint reports and gives guidance. It does not edit code.** There is no `fix` command. Each rule has fix guidance, and the coding agent of the user applies it. This is intentional. The agent already knows the framework and conventions of the user. If we write our own logic to edit code for each framework, that is the most expensive thing we could build.

**The source code of the user never goes out of their machine.** All repo scans run locally. I will put this product promise on the landing page. Thus make it mandatory with a test: scan a fixture with network interception on. Then make sure that no request body contains file contents or file paths.

**A licence key controls access. A hosted API checks the key.** The local package calls my server to validate the key. The server also runs scans of live URLs. Thus users do not need to install Chromium. The rules are in the local package. I accept that a determined person can copy them. Do not obfuscate the code. Do not build anti-tamper logic.

## What to build, in sequence

Stop after each milestone. Show me what operates. Wait for me before you start the next milestone.

**Milestone 1: rule engine and CLI.**
Build a `legal-lint` CLI with `scan <path>` for a repo and `scan-url <url>` for a live site. The two commands give the same finding format, as terminal output that is easy to read and as JSON (`--json`). In this milestone, make these items correct: the engine, the rule interface, the finding format and the fixture harness. Implement LL-01 fully as the first rule, static and runtime, to prove the design.

**Milestone 2: the other four MVP rules.**
Implement LL-02 to LL-05. Follow the detection notes of the rulebook. Add the intake config (`legal-lint.config.json`). `legal-lint init` creates it. The rulebook lists the questions. Each rule must read its applicability from this config. If there is no config, the rules that depend on intake report "needs intake answer". They do not fire.

**Milestone 3: batch URL scan.**
`legal-lint scan-urls <file>` reads a list of URLs. It writes one CSV row for each finding. I will use this myself to scan approximately 100 startups that launched recently. Then I will send each founder an email with their specific finding. This is how I validate the demand. The scan must be polite:

- One site at a time by default.
- A user agent that identifies the tool.
- Obey robots.txt.
- A small number of pages for each site.
- No form submissions and no logins.

**Milestone 4: MCP server.**
Build a local stdio MCP server in the same package. `npx legal-lint mcp` starts it. It uses the same engine. The MCP section below gives the details. Do not add a licence check in this milestone. Thus I can test it in Claude Code and Cursor first.

**Milestone 5: hosted API and licence keys.**
Build a small hosted service with two functions: validate licence keys, and run URL scans on request. Then connect the gate to the MCP server and the CLI. The licence section below gives the details.

These items are not in this phase: billing and checkout, a web UI, the GitHub App, a separate fix command, and rules LL-06 to LL-15. Design the engine so that we can add them later. But do not build them and do not make stubs for them.

## Technical decisions that are already made

- TypeScript on Node, in a pnpm workspace. The packages are:
  - `core`: the engine, the rule interface, the finding types.
  - `rules`: one folder for each rule.
  - `cli`: the CLI and the MCP server, published as one npm package.
  - `api`: the hosted service.
- Use Playwright for runtime checks. Record all network requests and cookies from the first load, before all interaction. The runtime engine is in `core`. Thus the CLI can run it locally (for my batch scans), and the API can run it for users.
- Static detection should prefer parsing to regex where this is important. Use the TypeScript compiler API or ts-morph for JS/TS. Use plain text search for HTML, CSS and config. Regex alone will give false positives on comments and strings.
- Do not use LLM API calls or a model API key at any location in this project. Some rules need a judgment (LL-02: is this email marketing or transactional?). For these rules, use heuristics for the obvious cases. Give the cases that are not clear to the host agent, as the MCP section tells.
- Use the official MCP TypeScript SDK. The SDK changes frequently. Thus read its current documentation before you write the server. Do not rely on memory.
- Use Vitest for tests.

If you think that one of these decisions is incorrect, and you can show me the reason, tell me before you build on it.

## The rule interface

Each rule is in its own folder. It exports:

- metadata (id, name, law citation, regions, phase, fix type),
- an `applies(intake)` function that returns yes, no or unknown,
- a `detectStatic(repo)` function, a `detectRuntime(page)` function, or the two.

Next to the code, each rule has two data files that a person who is not a programmer can review:

- **Legal text**: the trap, applies-when, exposure, source links and last-reviewed date. Copy them from the rulebook.
- **Fix guidance**: a coding agent follows it. It gives:
  - the goal,
  - the steps, with variants for each framework where they are different (Next.js App Router and Pages Router first),
  - the conditions that must be true after the fix, so that a re-scan passes,
  - a separate list of steps that only the owner can do, such as to register a DMCA agent or to confirm the renewal terms.

  Explain why each step is important. Thus the agent can change the step when the repo does not have the expected shape.

## The contents of a finding

A finding contains:

- the rule id,
- a stable finding id,
- a confidence level (high, medium, low),
- the evidence (file path and line range for static, request URL and timing for runtime),
- a plain-language explanation with two sentences,
- the "does not apply if" condition,
- the exposure line from the rulebook,
- the fix type.

A finding can also have the status `needs_judgment`. Then it contains a specific question and the material that is necessary to answer it. For LL-02, this is the email template and the location that sends it. The MCP section tells how the agent answers it.

The text has legal importance. Findings describe what the tool saw and the risk that it causes. They never say that the user "is violating" or "is non-compliant". They never promise that a fix makes the product compliant. Exposure figures always have the label statutory maximum or named case, exactly as in the rulebook. Each report ends with a short line that tells that this is not legal advice.

## The MCP server

The agent reads the description of a tool to decide when to call it. Thus write the descriptions carefully. Tell what the tool does, and exactly when an agent should use it. Show me the list of tools before you build it. This is my first list:

- **A pre-flight check.** The agent tells what it will build or add ("Stripe subscriptions", "Hotjar", "newsletter signup", "image uploads"). It gets back the applicable rules and what to do to prevent the traps. This is the most valuable tool, because it prevents the problem. It does not only report it. Its description should tell agents to call it before they add payments, analytics, tracking, email or SMS sending, user uploads, auth, or fonts.
- **Scan the repo.** Returns the findings for the current working tree.
- **Scan a URL.** Returns the runtime findings for a live or preview URL.
- **Fix guidance for a finding.** Returns the content of the guidance file for that rule, selected for the framework that the scan found. Also returns the steps that only the owner can do, for the agent to give to the user.
- **Answer a judgment question.** For a `needs_judgment` finding, the agent reads the material and answers the question. Then the server changes it into a usual finding or removes it. Do not depend on MCP sampling for this, because the client support for it is not the same in all clients.
- **Explain a rule.** A plain-language description, the law citation and the exposure, for when the user asks why.

After the agent applies a fix, it runs the repo scan again to make sure that the finding is not there. Tell this in the output of the fix guidance.

Tool results should be compact structured data with short text, because a model with limited context reads them. When there are many findings, return the top findings with a count of the others.

## Licence keys and the hosted API

- The key comes from the `LEGAL_LINT_KEY` environment variable, or from the config file.
- The local package validates the key with the API. It keeps a valid result in a cache for 24 hours. Thus the tool continues to operate offline, and it does not call the server for each scan.
- **Without a key** (free tier): the pre-flight check, the scans and the rule explanations operate. Findings show the rule, the confidence and the explanation. The tool does not show the evidence locations and the fix guidance. It shows a note of one line that tells that a key gives access to them. I want the free tier to prove that the problem is real, and the paid tier to solve it.
- **With a valid key**: all functions.
- The only data that goes to the API is the licence key, the package version, and, for URL scans, the URL. Write this in the README in plain words.
- The API must run Chromium. Thus it must be a service in a container, not a serverless function. Recommend a host and a simple key store. Keep the cost of operation low. I expect a small number of users at first.
- I issue keys with an admin script that I run manually. There is no signup, no payments and no dashboard at this time.
- Apply a rate limit to URL scans for each key, and for each IP address when there is no key, because each scan costs me real compute.
- The API must refuse to scan private and internal addresses (localhost, private IP ranges, cloud metadata endpoints), also after redirects. A URL scanner that gets each URL it is told to get is an open door into my own infrastructure.

## Fixtures

For each rule, create small fixture projects under `fixtures/<rule-id>/`:

- Two or more that should fire (different frameworks, or different types of the mistake).
- Two or more that should not fire. One does the correct thing. One is a near miss that looks like the trap but is not the trap. Examples: for LL-01, a self-hosted font file with "google" in its name; for LL-02, a password reset email with no unsubscribe link; for LL-03, PostHog installed with session recording disabled.
- For each fixture that fires, a `fixed` twin. The twin is the same project after a person followed the fix guidance manually. The test scans the twin and expects no finding. This proves that the guidance gives a scan that passes, without an agent in the test suite.

Runtime fixtures are served from a local static server in the test. Thus tests never connect to the network. The MCP server has its own tests. They call each tool through the client of the SDK and check the shape of the result, with a key and without a key.

Write detectors for the general case. If it is difficult for a fixture to pass, tell me why. Do not write special code for that fixture.

## How to work

- First, read `RULEBOOK.md`. Then recommend the repo layout and the TypeScript types for rule, finding and fix guidance. Wait for my approval before you write the engine.
- Commit at each step that operates, with a clear message.
- The legal figures and dates in the rulebook are drafts that nobody verified. Copy them as they are written. Do not correct them or add to them from your own knowledge. If an item looks incorrect, add it to `LEGAL_REVIEW.md` for the lawyer review.
- Keep a `DECISIONS.md` file with one line for each decision that is not obvious, and the reason.
- When you complete a milestone, tell me clearly what operates, what you tested, and what you did not do or are not sure about.
