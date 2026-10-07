# Architecture diagrams

Pictures of how Legal Lint fits together, for people and for coding agents. Each diagram is Mermaid text, so GitHub renders it and an agent can read it without an image. The prose in `CLAUDE.md` is the summary; these diagrams show the order of steps and where each decision is made.

Every diagram names the file that owns the behaviour. **If you change that behaviour, update the diagram in the same commit** (see `CONTRIBUTING.md`). A diagram that disagrees with the code is worse than no diagram.

1. [Packages and what they depend on](#1-packages-and-what-they-depend-on)
2. [Repo scan: from command to report](#2-repo-scan-from-command-to-report)
3. [How a raw finding gets its status](#3-how-a-raw-finding-gets-its-status)
4. [URL scan: local or hosted](#4-url-scan-local-or-hosted)
5. [Hosted scan request inside the API](#5-hosted-scan-request-inside-the-api)
6. [The three SSRF layers](#6-the-three-ssrf-layers)
7. [Licence gate](#7-licence-gate)
8. [What leaves the machine](#8-what-leaves-the-machine)
9. [Coding agent loop over MCP](#9-coding-agent-loop-over-mcp)
10. [Judgment questions and the content hash](#10-judgment-questions-and-the-content-hash)
11. [Anatomy of a rule](#11-anatomy-of-a-rule)
12. [Fixture test harness](#12-fixture-test-harness)

---

## 1. Packages and what they depend on

`core` and `rules` are private and consumed as TypeScript source. tsup bundles them into the CLI. The API imports core only through three subpaths, so the TypeScript compiler stays out of its bundle.

```mermaid
flowchart LR
  subgraph published["published"]
    cli["legal-lint (packages/cli)<br/>commander program, MCP server, licence gate"]
  end
  subgraph private["private, TS source"]
    rules["@legal-lint/rules<br/>LL-01 … LL-05"]
    core["@legal-lint/core<br/>engine, types, intake, judgments,<br/>reports, crawler, static helpers"]
  end
  subgraph hosted["Cloud Run"]
    api["@legal-lint/api<br/>Hono, Firestore, egress proxy"]
  end

  cli -->|"bundled in"| rules
  cli -->|"bundled in"| core
  rules --> core
  api -->|"@legal-lint/core/crawler<br/>/remote  /address"| core

  cli -.->|"optional, dynamic import"| pw[("playwright")]
  cli -.->|"loaded only by the mcp command"| mcp[("@modelcontextprotocol/server")]
  core -.-> ts[("typescript compiler API")]
  api -.-> pw
  api -.-> fs[("Firestore")]
```

## 2. Repo scan: from command to report

`legal-lint scan` and MCP `scan_repo` take the same path. Owners: `cli/src/program.ts`, `cli/src/mcp/server.ts`, `core/src/engine.ts`, `core/src/static/repo-index.ts`.

```mermaid
sequenceDiagram
  autonumber
  participant U as CLI scan / MCP scan_repo
  participant G as licence gate<br/>(cli/src/licence/gate.ts)
  participant E as scanRepo<br/>(core/src/engine.ts)
  participant C as legal-lint.config.json
  participant I as buildRepoIndex<br/>(core/src/static/repo-index.ts)
  participant R as each rule

  U->>G: checkLicence()
  G-->>U: Licence (or LicenceError, exit 2)
  U->>E: scanRepo(root, {rules, only})
  E->>C: loadConfig(root)
  C-->>E: intake + stored judgments
  E->>I: build once
  Note over I: skips .gitignore paths, node_modules,<br/>build output, .legal-lint, files over 1 MB.<br/>Reads and parses lazily, cached per file.
  I-->>E: RepoIndex (files, read, sourceFile, packages, frameworks)
  loop rules that have detectStatic, filtered by --rule
    E->>R: applies(intake)
    alt applies = no
      Note over E,R: rule skipped, still listed in rulesRun
    else yes or unknown
      E->>R: detectStatic(repo, {intake})
      R-->>E: RawFinding[] (or throws: RuleRun.error, other rules continue)
      E->>E: toFinding (diagram 3)
    end
  end
  E->>E: sort by status, confidence, rule, id
  E-->>U: ScanReport + disclaimer
  U->>U: text or --json, optional --html
  Note over U: exit 0 no open findings, 1 open findings, 2 could not run
```

## 3. How a raw finding gets its status

`toFinding` in `core/src/engine.ts`. Order matters: missing intake wins over a judgment question. Only `open` findings fail the CLI.

```mermaid
flowchart TD
  raw["RawFinding from a detector"] --> id["id = hash(ruleId, key)<br/>key is a file or page path, never a line"]
  id --> miss{"intake answers missing?<br/>(applies = unknown, or raw.needsIntake)"}
  miss -->|yes| ni["needs_intake<br/>+ the questions to ask"]
  miss -->|no| hasj{"raw.judgment?"}
  hasj -->|no| open["open"]
  hasj -->|yes| hash["contentHash(material)"]
  hash --> stored{"stored answer for this id<br/>with the same contentHash?"}
  stored -->|no| nj["needs_judgment<br/>+ question, options, material, hash"]
  stored -->|yes| out{"option outcome"}
  out -->|drop| gone["dropped, not reported"]
  out -->|open| openhi["open, confidence raised to high"]

  classDef fail fill:#fde2e1,stroke:#c0392b,color:#000
  classDef wait fill:#fff4d6,stroke:#b7950b,color:#000
  classDef quiet fill:#e3f4e1,stroke:#1e8449,color:#000
  class open,openhi fail
  class ni,nj wait
  class gone quiet
```

## 4. URL scan: local or hosted

`scanUrl` in `cli/src/scan-url.ts`. Whoever records the capture, **the rules always run on the user's machine** with local intake and judgments. The hosted API only records.

```mermaid
flowchart TD
  start["CLI scan-url or MCP scan_url"] --> gate["licence gate, then: http or https only"]
  gate --> local{"--local, or localhost /<br/>private address?<br/>(isLocalTarget)"}
  local -->|yes| crawl["captureSite on this machine<br/>(core/src/runtime/crawler.ts, needs Playwright)"]
  local -->|no| api{"API URL configured?<br/>LEGAL_LINT_API_URL or DEFAULT_API_URL"}
  api -->|no| noapi["error: add --local"]
  api -->|yes| remote["POST /v1/scan<br/>sends only url, version, Bearer key<br/>(cli/src/licence/api.ts remoteCapture)"]
  remote --> cap["SiteCapture (zod-checked, gzip)"]
  crawl --> cap
  cap --> first{"start page loaded?"}
  first -->|no| fail["error: could not load, exit 2"]
  first -->|yes| eval["evaluateCapture: each rule's detectRuntime(capture)<br/>+ toFinding (diagram 3)"]
  eval --> report["ScanReport"]
```

What the crawler records, in `captureSite`:

```mermaid
flowchart LR
  p0["start URL"] -->|"goto, wait load,<br/>then networkidle up to 5 s"| rec["record per page:<br/>requests + ms since navigation,<br/>websockets, cookies, text, html, links"]
  rec --> pick["pickFollowLinks: same-origin links whose path or text<br/>matches pricing, plans, billing, dmca, terms, legal …<br/>pricing first"]
  pick -->|"up to 4 more pages,<br/>stop when budgetMs is spent"| rec
  rec --> done["SiteCapture"]
  dl["deadlineMs passes"] -.->|"closes the browser context"| thrown["crawl throws: the scan stopped,<br/>no capture is returned"]
  never["never clicks, types, scrolls or submits:<br/>everything recorded happened before consent"]
```

## 5. Hosted scan request inside the API

`POST /v1/scan` in `api/src/app.ts`. Cheap refusals come first, so a spent key or a spent month costs no store read and no queue place. Usage is counted only when Chromium is about to start.

```mermaid
flowchart TD
  req["POST /v1/scan"] --> body4k{"body over 4 KB?"} -->|yes| r413["413 bad_request"]
  body4k -->|no| ipblk{"IP over failed-auth limit?"} -->|yes| r429a["429 too_many_requests"]
  ipblk -->|no| memo{"key remembered as over<br/>its hourly or daily limit?"} -->|yes| r429b["429 key_hour / key_day"]
  memo -->|no| key{"checkKey: ll_ pattern, sha256 in store,<br/>not revoked, not expired"}
  key -->|no| r401["401 unauthorized<br/>(counts a failed auth for the IP)"]
  key -->|yes| month{"month remembered as spent?"} -->|yes| r503m["503 monthly_budget"]
  month -->|no| schema{"body is exactly {url, version}?"} -->|no| r400["400 bad_request"]
  schema -->|yes| target{"checkTarget (SSRF layer 1)"} -->|no| r400b["400 bad_url / private_address"]
  target -->|yes| queue{"ScanQueue: 2 running, 4 waiting"}
  queue -->|full| r503b["503 busy"]
  queue -->|slot| reserve{"usage.reserveScan<br/>month, then day, then hour"}
  reserve -->|over| remember["remember until the window ends"] --> r429c["429 key_* or 503 monthly_budget"]
  reserve -->|ok| scan["scanner.scan: Chromium behind the egress proxy<br/>page 15 s, budget 40 s, deadline 60 s"]
  scan -->|throws| r502["502 scan_failed"]
  scan -->|ok| cap["cap html 1M and text 300k chars per page,<br/>gzip, 200 {capture}"]
```

Default numbers come from `api/src/config.ts` and can be changed with environment variables (listed in `packages/api/DEPLOY.md`). `POST /v1/licence` is simpler: IP failed-auth block, 30 checks per IP per hour, strict `{key, version}`, then `checkKey`.

## 6. The three SSRF layers

The hosted scanner must never reach an internal address, even through a redirect, a subresource or DNS that changes its answer. Owners: `api/src/egress/target.ts`, `api/src/egress/proxy.ts`, `api/src/scan.ts`.

```mermaid
flowchart LR
  url["requested URL"] --> L1
  subgraph L1["Layer 1: checkTarget (before any browser)"]
    a1["http/https only, no user:pass"] --> a2["not localhost or private name"] --> a3["vetHost: every resolved address<br/>public, port 80 or 443"]
  end
  L1 --> chrome["Chromium<br/>proxy = 127.0.0.1 egress proxy"]
  subgraph L3["Layer 3: Chromium flags"]
    f["no QUIC,<br/>no non-proxied WebRTC UDP"]
  end
  chrome -.- L3
  chrome -->|"every navigation, redirect,<br/>subresource, iframe, websocket"| L2
  subgraph L2["Layer 2: egress proxy"]
    b1["resolve name itself"] --> b2["vetHost on every address"] --> b3["connect to the checked IP,<br/>not the name"]
  end
  L2 -->|allowed| net(("public web"))
  L2 -->|refused| x["403, logged in proxy.refused"]
```

## 7. Licence gate

`checkLicence` in `cli/src/licence/gate.ts`. There is no free tier: every CLI scan and every MCP tool calls it first. The API is asked at most once a day per key.

```mermaid
flowchart TD
  s["checkLicence"] --> find{"key in LEGAL_LINT_KEY<br/>or ~/.legal-lint/key?"}
  find -->|no| nokey["LicenceError: set a key"]
  find -->|yes| cache{"cache for this key hash,<br/>not past expiresAt?"}
  cache -->|"yes, checked under 24 h ago"| okc["run (no network)"]
  cache -->|"no, or older"| ask["POST /v1/licence {key, version}"]
  ask -->|valid| write["write cache"] --> ok["run"]
  ask -->|"invalid: unknown, revoked, expired"| clear["clear cache"] --> bad["LicenceError"]
  ask -->|"unreachable, 429 or 5xx"| grace{"cache checked under 7 days ago?"}
  grace -->|yes| warn["run, with a grace warning on stderr"]
  grace -->|no| off["LicenceError: connect and retry"]
```

`legal-lint activate <key>` asks the API first and saves the key (mode 0600) only when it is valid. The key never goes into `legal-lint.config.json`.

## 8. What leaves the machine

The privacy promise, enforced by `tests/privacy.test.ts` and the strict zod schemas in `core/src/remote.ts`.

```mermaid
flowchart LR
  subgraph machine["user's machine"]
    src["source code"]
    cfg["legal-lint.config.json<br/>intake + judgments"]
    eng["legal-lint CLI or MCP<br/>licence gate, rules, engine"]
    rep["report, .legal-lint/report.html"]
  end
  subgraph cloud["hosted API"]
    lic["/v1/licence"]
    scan["/v1/scan"]
  end
  eng -->|"key + version, at most daily"| lic
  eng -->|"url + version + key<br/>(public URL scans only)"| scan
  scan -->|"raw SiteCapture"| eng
  src --> eng
  cfg --> eng
  eng --> rep
  src -. "never sent" .-x cloud
  cfg -. "never sent" .-x cloud
```

## 9. Coding agent loop over MCP

The intended loop, from the server instructions in `cli/src/mcp/server.ts`. Every tool checks the licence first. Legal Lint never edits code; the agent does.

```mermaid
flowchart TD
  plan["agent is about to build payments, analytics,<br/>email, uploads, auth or fonts"] --> pre["preflight_check(building)<br/>matching rules, mustBeTrue, ownerSteps"]
  pre --> build["agent writes code"]
  build --> scan["scan_repo (or scan_url on a preview)"]
  scan --> st{"each finding's status"}
  st -->|open| fix["get_fix_guidance(findingId)<br/>steps for the detected framework"] --> apply["agent applies the steps"] --> scan
  st -->|needs_judgment| judge["agent reads the material,<br/>answer_judgment(findingId, answer, contentHash, reason)"] --> scan
  st -->|needs_intake| askuser["agent asks the USER,<br/>answer_intake(answers). Never guess."] --> scan
  st -->|none left| tell["tell the user where the HTML report is<br/>and pass on ownerSteps"]
  explain["explain_rule(ruleId)"] -.->|any time| scan
```

## 10. Judgment questions and the content hash

How `answer_judgment` stores an answer and why it expires by itself. Owners: `core/src/judgments.ts`, `answer_judgment` in `cli/src/mcp/server.ts`.

```mermaid
sequenceDiagram
  autonumber
  participant A as agent
  participant M as MCP answer_judgment
  participant E as scanRepo
  participant C as legal-lint.config.json

  A->>M: findingId, answer, contentHash, reason
  M->>E: fresh scan of that rule, ignoring stored answers
  E-->>M: the finding now
  alt finding gone / needs_intake / no judgment
    M-->>A: error, with what to do next
  else contentHash differs
    M-->>A: error: material changed, scan and read again
  else answer not an option
    M-->>A: error: list the options
  else
    M->>C: judgments[findingId] = {answer, contentHash, answeredAt, answeredBy: agent, reason}
    M->>E: scan that rule again with stored answers
    E-->>M: finding open (high confidence) or dropped
    M-->>A: outcome + next steps
  end
  Note over C: When the material's text changes, its hash changes,<br/>the stored answer stops matching, and the question comes back.
```

## 11. Anatomy of a rule

One folder per rule in `packages/rules/src/`. `defineRule` in `core/src/define-rule.ts` validates the YAML at load time. Full recipe: `docs/adding-a-rule.md`.

```mermaid
flowchart LR
  subgraph folder["packages/rules/src/LL-0N-slug/"]
    idx["index.ts<br/>meta, applies(intake)"]
    legal["legal.yaml<br/>word for word from RULEBOOK.md"]
    fixy["fix.yaml<br/>goal, steps per framework,<br/>doneWhen, ownerSteps"]
    st["static.ts<br/>detectStatic(repo, ctx)"]
    rt["runtime.ts<br/>detectRuntime(capture, ctx), pure"]
  end
  legal -->|"?raw import"| def["defineRule<br/>zod-validates both YAML files,<br/>checks id, name, law, fixType agree"]
  fixy -->|"?raw import"| def
  idx --> def
  st --> def
  rt --> def
  def --> arr["rules array<br/>(packages/rules/src/index.ts)"]
  book["RULEBOOK.md"] -.->|"tests/rulebook-sync.test.ts"| legal
```

Which detectors each rule has today:

| Rule | static | runtime | Notes |
|---|---|---|---|
| LL-01 Google Fonts | yes | yes | |
| LL-02 Marketing email | yes | | unclear cases become `needs_judgment` |
| LL-03 Session replay | yes | yes | |
| LL-04 Auto-renewal | yes | yes | |
| LL-05 DMCA agent | yes | | intake-driven, absence evidence |

## 12. Fixture test harness

`tests/fixtures.test.ts` finds every folder under `fixtures/<rule>/<name>/` and checks it by its name prefix. `tests/fixture-meta.test.ts` checks that each rule and mode has enough fixtures.

```mermaid
flowchart TD
  dir["fixtures/LL-0N/name/<br/>expect.json: mode, description, findings"] --> mode{"mode"}
  mode -->|static| sr["scanRepo(dir, only this rule)"]
  mode -->|runtime| srv["serve site/ on 127.0.0.1"] --> cap["captureSite offline:<br/>other hosts recorded, answered locally"] --> ev["evaluateCapture"]
  sr --> cmp
  ev --> cmp
  cmp{"name prefix"}
  cmp -->|"fires-*"| f1["exactly the listed findings<br/>+ a .fixed twin that scans clean"]
  cmp -->|"pass-*, near-miss-*"| f2["no findings"]
  cmp -->|"intake-*, judgment-*"| f3["listed needs_intake / needs_judgment<br/>or answered outcome"]
  f1 --> shape["every finding: two-sentence explanation, no banned words,<br/>id format, exposure, evidence, disclaimer"]
  f2 --> shape
  f3 --> shape
  shape --> cross["cross-rule quiet: no rule reports an open finding<br/>on any static pass, near-miss or .fixed fixture"]
```
