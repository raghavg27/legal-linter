# Architecture diagrams

These diagrams show how the parts of Legal Lint connect. They are for persons and for coding agents. Each diagram is Mermaid text. Thus GitHub renders it, and an agent can read it without an image. The text in `CLAUDE.md` is the summary. These diagrams show the sequence of the steps and the location of each decision.

Each diagram names the file that owns the behaviour. **If you change that behaviour, update the diagram in the same commit** (see `CONTRIBUTING.md`). A diagram that does not agree with the code is worse than no diagram.

1. [Packages and their dependencies](#1-packages-and-their-dependencies)
2. [Repo scan: from command to report](#2-repo-scan-from-command-to-report)
3. [How a raw finding gets its status](#3-how-a-raw-finding-gets-its-status)
4. [URL scan: local or hosted](#4-url-scan-local-or-hosted)
5. [Hosted scan request in the API](#5-hosted-scan-request-in-the-api)
6. [The three SSRF layers](#6-the-three-ssrf-layers)
7. [Licence gate](#7-licence-gate)
8. [Data that goes out of the machine](#8-data-that-goes-out-of-the-machine)
9. [Coding agent loop over MCP](#9-coding-agent-loop-over-mcp)
10. [Judgment questions and the content hash](#10-judgment-questions-and-the-content-hash)
11. [Parts of a rule](#11-parts-of-a-rule)
12. [Fixture test harness](#12-fixture-test-harness)

---

## 1. Packages and their dependencies

`core` and `rules` are private. Other packages use them as TypeScript source. tsup bundles them into the CLI. The API imports core only through three subpaths. Thus the TypeScript compiler does not go into the bundle of the API.

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
  cli -.->|"only the mcp command loads it"| mcp[("@modelcontextprotocol/server")]
  core -.-> ts[("typescript compiler API")]
  api -.-> pw
  api -.-> fs[("Firestore")]
```

## 2. Repo scan: from command to report

`legal-lint scan` and MCP `scan_repo` use the same path. Owners: `cli/src/program.ts`, `cli/src/mcp/server.ts`, `core/src/engine.ts`, `core/src/static/repo-index.ts`.

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
  E->>I: build one time
  Note over I: does not include .gitignore paths, node_modules,<br/>build output, .legal-lint, files larger than 1 MB.<br/>Reads and parses a file only when necessary. Keeps the result for each file.
  I-->>E: RepoIndex (files, read, sourceFile, packages, frameworks)
  loop rules that have detectStatic, selected by --rule
    E->>R: applies(intake)
    alt applies = no
      Note over E,R: the rule does not run. It is still in rulesRun.
    else yes or unknown
      E->>R: detectStatic(repo, {intake})
      R-->>E: RawFinding[] (or an error: RuleRun.error. The other rules continue.)
      E->>E: toFinding (diagram 3)
    end
  end
  E->>E: sort by status, confidence, rule, id
  E-->>U: ScanReport + disclaimer
  U->>U: text or --json, optional --html
  Note over U: exit 0: no open findings. 1: open findings. 2: could not run.
```

## 3. How a raw finding gets its status

`toFinding` in `core/src/engine.ts`. The sequence is important: missing intake comes before a judgment question. Only `open` findings make the CLI fail.

```mermaid
flowchart TD
  raw["RawFinding from a detector"] --> id["id = hash(ruleId, key)<br/>the key is a file or page path, never a line"]
  id --> miss{"intake answers missing?<br/>(applies = unknown, or raw.needsIntake)"}
  miss -->|yes| ni["needs_intake<br/>+ the questions to ask"]
  miss -->|no| hasj{"raw.judgment?"}
  hasj -->|no| open["open"]
  hasj -->|yes| hash["contentHash(material)"]
  hash --> stored{"stored answer for this id<br/>with the same contentHash?"}
  stored -->|no| nj["needs_judgment<br/>+ question, options, material, hash"]
  stored -->|yes| out{"outcome of the option"}
  out -->|drop| gone["removed, not reported"]
  out -->|open| openhi["open, confidence increased to high"]

  classDef fail fill:#fde2e1,stroke:#c0392b,color:#000
  classDef wait fill:#fff4d6,stroke:#b7950b,color:#000
  classDef quiet fill:#e3f4e1,stroke:#1e8449,color:#000
  class open,openhi fail
  class ni,nj wait
  class gone quiet
```

## 4. URL scan: local or hosted

`scanUrl` in `cli/src/scan-url.ts`. The capture can come from the local machine or from the hosted API. In the two cases, **the rules always run on the machine of the user** with the local intake and judgments. The hosted API only records.

```mermaid
flowchart TD
  start["CLI scan-url or MCP scan_url"] --> gate["licence gate, then: only http or https"]
  gate --> local{"--local, or localhost /<br/>private address?<br/>(isLocalTarget)"}
  local -->|yes| crawl["captureSite on this machine<br/>(core/src/runtime/crawler.ts, needs Playwright)"]
  local -->|no| api{"API URL set?<br/>LEGAL_LINT_API_URL or DEFAULT_API_URL"}
  api -->|no| noapi["error: add --local"]
  api -->|yes| remote["POST /v1/scan<br/>sends only url, version, Bearer key<br/>(cli/src/licence/api.ts remoteCapture)"]
  remote --> cap["SiteCapture (zod check, gzip)"]
  crawl --> cap
  cap --> first{"start page loaded?"}
  first -->|no| fail["error: could not load, exit 2"]
  first -->|yes| eval["evaluateCapture: detectRuntime(capture) of each rule<br/>+ toFinding (diagram 3)"]
  eval --> report["ScanReport"]
```

The data that the crawler records, in `captureSite`:

```mermaid
flowchart LR
  p0["start URL"] -->|"goto, wait for load,<br/>then networkidle for a maximum of 5 s"| rec["record for each page:<br/>requests + ms after navigation,<br/>websockets, cookies, text, html, links"]
  rec --> pick["pickFollowLinks: links on the same origin with a path or text<br/>that matches pricing, plans, billing, dmca, terms, legal …<br/>pricing first"]
  pick -->|"a maximum of 4 more pages,<br/>stop when budgetMs is used"| rec
  rec --> done["SiteCapture"]
  dl["deadlineMs ends"] -.->|"closes the browser context"| thrown["crawl throws an error: the scan stopped,<br/>no capture is returned"]
  never["never clicks, types, scrolls or submits:<br/>all recorded data occurred before consent"]
```

## 5. Hosted scan request in the API

`POST /v1/scan` in `api/src/app.ts`. The refusals that cost little come first. Thus a key or a month that has no more scans does not cause a store read and does not use a queue position. The API counts the usage only immediately before Chromium starts.

```mermaid
flowchart TD
  req["POST /v1/scan"] --> body4k{"body larger than 4 KB?"} -->|yes| r413["413 bad_request"]
  body4k -->|no| ipblk{"IP over the failed-auth limit?"} -->|yes| r429a["429 too_many_requests"]
  ipblk -->|no| memo{"key known to be over<br/>its hourly or daily limit?"} -->|yes| r429b["429 key_hour / key_day"]
  memo -->|no| key{"checkKey: ll_ pattern, sha256 in store,<br/>not revoked, not expired"}
  key -->|no| r401["401 unauthorized<br/>(counts a failed auth for the IP)"]
  key -->|yes| month{"month known to have no more scans?"} -->|yes| r503m["503 monthly_budget"]
  month -->|no| schema{"body is exactly {url, version}?"} -->|no| r400["400 bad_request"]
  schema -->|yes| target{"checkTarget (SSRF layer 1)"} -->|no| r400b["400 bad_url / private_address"]
  target -->|yes| queue{"ScanQueue: 2 run, 4 wait"}
  queue -->|full| r503b["503 busy"]
  queue -->|position available| reserve{"usage.reserveScan<br/>month, then day, then hour"}
  reserve -->|over| remember["remember until the window ends"] --> r429c["429 key_* or 503 monthly_budget"]
  reserve -->|ok| scan["scanner.scan: Chromium behind the egress proxy<br/>page 15 s, budget 40 s, deadline 60 s"]
  scan -->|error| r502["502 scan_failed"]
  scan -->|ok| cap["limit each page to 1M chars of html and 300k chars of text,<br/>gzip, 200 {capture}"]
```

The default numbers come from `api/src/config.ts`. You can change them with environment variables (`packages/api/DEPLOY.md` lists them). `POST /v1/licence` is more simple: the failed-auth block for each IP, 30 checks for each IP for each hour, a strict `{key, version}` body, then `checkKey`.

## 6. The three SSRF layers

The hosted scanner must never connect to an internal address. This is also true for a redirect, a subresource, or DNS that changes its answer. Owners: `api/src/egress/target.ts`, `api/src/egress/proxy.ts`, `api/src/scan.ts`.

```mermaid
flowchart LR
  url["requested URL"] --> L1
  subgraph L1["Layer 1: checkTarget (before the browser starts)"]
    a1["only http/https, no user:pass"] --> a2["not localhost or a private name"] --> a3["vetHost: each resolved address<br/>is public, port 80 or 443"]
  end
  L1 --> chrome["Chromium<br/>proxy = 127.0.0.1 egress proxy"]
  subgraph L3["Layer 3: Chromium flags"]
    f["no QUIC,<br/>no WebRTC UDP outside the proxy"]
  end
  chrome -.- L3
  chrome -->|"each navigation, redirect,<br/>subresource, iframe, websocket"| L2
  subgraph L2["Layer 2: egress proxy"]
    b1["resolves the name itself"] --> b2["vetHost on each address"] --> b3["connects to the checked IP,<br/>not to the name"]
  end
  L2 -->|permitted| net(("public web"))
  L2 -->|refused| x["403, logged in proxy.refused"]
```

## 7. Licence gate

`checkLicence` in `cli/src/licence/gate.ts`. There is no free tier. Each CLI scan and each MCP tool calls it first. The CLI asks the API a maximum of one time each day for each key.

```mermaid
flowchart TD
  s["checkLicence"] --> find{"key in LEGAL_LINT_KEY<br/>or ~/.legal-lint/key?"}
  find -->|no| nokey["LicenceError: set a key"]
  find -->|yes| cache{"cache for this key hash,<br/>before expiresAt?"}
  cache -->|"yes, checked less than 24 h ago"| okc["run (no network)"]
  cache -->|"no, or older"| ask["POST /v1/licence {key, version}"]
  ask -->|valid| write["write cache"] --> ok["run"]
  ask -->|"not valid: unknown, revoked, expired"| clear["clear cache"] --> bad["LicenceError"]
  ask -->|"no connection, 429 or 5xx"| grace{"cache checked less than 7 days ago?"}
  grace -->|yes| warn["run, with a grace warning on stderr"]
  grace -->|no| off["LicenceError: connect and try again"]
```

`legal-lint activate <key>` asks the API first. It keeps the key (mode 0600) only when the key is valid. The key never goes into `legal-lint.config.json`.

## 8. Data that goes out of the machine

This is the privacy promise. `tests/privacy.test.ts` and the strict zod schemas in `core/src/remote.ts` make it mandatory.

```mermaid
flowchart LR
  subgraph machine["machine of the user"]
    src["source code"]
    cfg["legal-lint.config.json<br/>intake + judgments"]
    eng["legal-lint CLI or MCP<br/>licence gate, rules, engine"]
    rep["report, .legal-lint/report.html"]
  end
  subgraph cloud["hosted API"]
    lic["/v1/licence"]
    scan["/v1/scan"]
  end
  eng -->|"key + version, a maximum of one time each day"| lic
  eng -->|"url + version + key<br/>(only public URL scans)"| scan
  scan -->|"raw SiteCapture"| eng
  src --> eng
  cfg --> eng
  eng --> rep
  src -. "never sent" .-x cloud
  cfg -. "never sent" .-x cloud
```

## 9. Coding agent loop over MCP

This is the loop that we expect. It comes from the server instructions in `cli/src/mcp/server.ts`. Each tool checks the licence first. Legal Lint never edits code. The agent edits the code.

```mermaid
flowchart TD
  plan["agent will build payments, analytics,<br/>email, uploads, auth or fonts"] --> pre["preflight_check(building)<br/>applicable rules, mustBeTrue, ownerSteps"]
  pre --> build["agent writes code"]
  build --> scan["scan_repo (or scan_url on a preview)"]
  scan --> st{"status of each finding"}
  st -->|open| fix["get_fix_guidance(findingId)<br/>steps for the framework that the scan found"] --> apply["agent applies the steps"] --> scan
  st -->|needs_judgment| judge["agent reads the material,<br/>answer_judgment(findingId, answer, contentHash, reason)"] --> scan
  st -->|needs_intake| askuser["agent asks the USER,<br/>answer_intake(answers). Never guess."] --> scan
  st -->|no more findings| tell["tell the user the location of the HTML report<br/>and give the ownerSteps"]
  explain["explain_rule(ruleId)"] -.->|at any time| scan
```

## 10. Judgment questions and the content hash

This diagram shows how `answer_judgment` keeps an answer and why the answer stops being valid automatically. Owners: `core/src/judgments.ts`, `answer_judgment` in `cli/src/mcp/server.ts`.

```mermaid
sequenceDiagram
  autonumber
  participant A as agent
  participant M as MCP answer_judgment
  participant E as scanRepo
  participant C as legal-lint.config.json

  A->>M: findingId, answer, contentHash, reason
  M->>E: new scan of that rule, without the stored answers
  E-->>M: the current finding
  alt no finding / needs_intake / no judgment
    M-->>A: error, with the next thing to do
  else contentHash is different
    M-->>A: error: material changed, scan and read again
  else answer is not an option
    M-->>A: error: list the options
  else
    M->>C: judgments[findingId] = {answer, contentHash, answeredAt, answeredBy: agent, reason}
    M->>E: scan that rule again with the stored answers
    E-->>M: finding open (high confidence) or removed
    M-->>A: outcome + next steps
  end
  Note over C: When the text of the material changes, its hash changes.<br/>The stored answer then does not match, and the question shows again.
```

## 11. Parts of a rule

There is one folder for each rule in `packages/rules/src/`. When the rules load, `defineRule` in `core/src/define-rule.ts` validates the YAML. For the full procedure, read `docs/adding-a-rule.md`.

```mermaid
flowchart LR
  subgraph folder["packages/rules/src/LL-0N-slug/"]
    idx["index.ts<br/>meta, applies(intake)"]
    legal["legal.yaml<br/>word for word from RULEBOOK.md"]
    fixy["fix.yaml<br/>goal, steps for each framework,<br/>doneWhen, ownerSteps"]
    st["static.ts<br/>detectStatic(repo, ctx)"]
    rt["runtime.ts<br/>detectRuntime(capture, ctx), pure"]
  end
  legal -->|"?raw import"| def["defineRule<br/>validates the two YAML files with zod,<br/>makes sure that id, name, law, fixType agree"]
  fixy -->|"?raw import"| def
  idx --> def
  st --> def
  rt --> def
  def --> arr["rules array<br/>(packages/rules/src/index.ts)"]
  book["RULEBOOK.md"] -.->|"tests/rulebook-sync.test.ts"| legal
```

The detectors that each rule has at this time:

| Rule | static | runtime | Notes |
|---|---|---|---|
| LL-01 Google Fonts | yes | yes | |
| LL-02 Marketing email | yes | | cases that are not clear become `needs_judgment` |
| LL-03 Session replay | yes | yes | |
| LL-04 Auto-renewal | yes | yes | |
| LL-05 DMCA agent | yes | | applicability from intake, evidence of absence |

## 12. Fixture test harness

`tests/fixtures.test.ts` finds each folder in `fixtures/<rule>/<name>/`. It tests each folder by the prefix of its name. `tests/fixture-meta.test.ts` makes sure that each rule and mode has sufficient fixtures.

```mermaid
flowchart TD
  dir["fixtures/LL-0N/name/<br/>expect.json: mode, description, findings"] --> mode{"mode"}
  mode -->|static| sr["scanRepo(dir, only this rule)"]
  mode -->|runtime| srv["serve site/ on 127.0.0.1"] --> cap["captureSite offline:<br/>records other hosts, answers them locally"] --> ev["evaluateCapture"]
  sr --> cmp
  ev --> cmp
  cmp{"name prefix"}
  cmp -->|"fires-*"| f1["exactly the listed findings<br/>+ a .fixed twin with no findings"]
  cmp -->|"pass-*, near-miss-*"| f2["no findings"]
  cmp -->|"intake-*, judgment-*"| f3["listed needs_intake / needs_judgment<br/>or the outcome of the answer"]
  f1 --> shape["each finding: explanation with two sentences, no banned words,<br/>id format, exposure, evidence, disclaimer"]
  f2 --> shape
  f3 --> shape
  shape --> cross["quiet test for all rules: no rule gives an open finding<br/>on a static pass, near-miss or .fixed fixture"]
```
