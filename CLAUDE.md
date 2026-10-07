# CLAUDE.md

This file gives guidance to Claude Code (claude.ai/code) for work on the code in this repository.

## What this is

Legal Lint is a linter. It finds legal traps in startup codebases and live sites (rules LL-01 to LL-05 of `RULEBOOK.md`). It **reports and gives guidance. It never edits code.** The main user is a coding agent that calls it through the MCP server. The original brief is `CLAUDE_CODE_PROMPT.md`. Where `DECISIONS.md` is different from the brief, `DECISIONS.md` is correct. For example, there is **no free tier**, and MCP returns all findings, not only the first few.

## Commands

This is a pnpm workspace. It needs Node 20 or later (the API needs Node 22). pnpm 10.34.6 is pinned.

```sh
pnpm install
pnpm test                                   # vitest: tests/** and packages/*/src/**/*.test.ts
pnpm vitest run tests/fixtures.test.ts      # one file
pnpm vitest run -t "LL-01 fires-html"       # select tests by name. Fixture test names are "<rule> <fixture>: <description>".
pnpm typecheck                              # tsc --noEmit on all packages and tests
pnpm build                                  # bundles the CLI to packages/cli/dist (tsup)
pnpm build:api                              # bundles the hosted API to packages/api/dist
node packages/cli/dist/bin.js scan <path>   # run the built CLI
```

- The runtime fixture tests and the egress tests need the Chromium of Playwright (`npx playwright install chromium`). These tests never connect to the network. The sites are served from 127.0.0.1.
- `tests/mcp-stdio.test.ts` runs the built `packages/cli/dist/bin.js` over real stdio.
- `packages/api/src/firestore-store.test.ts` runs only when `FIRESTORE_EMULATOR_HOST` is set.
- `tests/setup/licence.ts` gives a licence to each test by default. It makes a temporary `LEGAL_LINT_HOME` with a key and an empty cache. It also sets `LEGAL_LINT_API_URL` to a port where no server runs. The tests of the licence gate make their own home.

## Architecture

`docs/architecture.md` has Mermaid diagrams of each flow in this section: packages, repo scan, finding status, URL scan routing, the API request pipeline, SSRF layers, licence gate, data egress, the MCP agent loop, judgments, rule anatomy, fixtures. Before you change a flow, read the applicable diagram. Update the diagram in the same commit. `tests/architecture-doc.test.ts` fails when a diagram names a file that does not exist.

Packages in `packages/`:

- **core** (`@legal-lint/core`, private). Other packages use it as TS source through `exports`. It contains:
  - the engine (`engine.ts`: `scanRepo`, `scanSite`, `evaluateCapture`),
  - the types and the zod schemas,
  - intake and config (`intake.ts`),
  - judgments, the selection of fix guidance, and the matching of preflight topics,
  - the text and HTML reports,
  - the Playwright crawler (`runtime/crawler.ts`),
  - the static helpers (`static/`: TS compiler API syntax trees, repo index, file kinds, routes),
  - the SSRF address checks (`net/address.ts`).
- **rules** (`@legal-lint/rules`). There is one folder for each rule (`LL-0N-<slug>/`). `index.ts` calls `defineRule({ meta, legalYaml, fixYaml, applies, detectStatic?, detectRuntime? })`. `src/index.ts` exports the `rules` array. The shared applicability helpers and email helpers are in `shared/`.
- **cli** (the published `legal-lint` npm package). It contains:
  - the commander program (`program.ts`: init, scan, scan-url, mcp, activate, licence),
  - the MCP stdio server (`mcp/`, MCP SDK v2 `@modelcontextprotocol/server`). Only the `mcp` command loads it.
  - the licence gate (`licence/`).

  tsup bundles core and rules into the CLI. Playwright is an optional, external dependency. The CLI loads it with a dynamic import.
- **api** (`@legal-lint/api`, Hono on Cloud Run with Firestore). It validates licence keys and runs hosted URL scans. It has rate limits, a monthly limit, a deadline for each scan, and an egress proxy in the process (`egress/`) for SSRF defence. The admin code that issues keys is in `admin.ts`. The API imports core only through subpaths (`@legal-lint/core/crawler`, `/remote`, `/address`). Thus the TypeScript compiler does not go into the bundle. The deploy steps are in `packages/api/DEPLOY.md`. `DEFAULT_API_URL` in `cli/src/licence/api.ts` stays empty until the first deploy.

### The flow of a scan

1. A static scan builds a `RepoIndex` one time. The index does not include gitignored paths, node_modules, build output, tests, fixtures, minified files and files larger than 1 MB. The `detectStatic` of each rule returns `RawFinding` objects.
2. A runtime scan: the crawler records one `SiteCapture`. The capture has the start URL and a maximum of 4 pricing or legal links on the same origin. The crawler never clicks, types or submits. The `detectRuntime(capture)` of each rule is a pure function of that recording. For public URLs, **the hosted API records and the CLI makes the decisions**. The API returns only the raw capture. The rules run locally with the local intake and judgments. Localhost, private addresses and `--local` always crawl on the local machine.
3. `toFinding` in `engine.ts` uses the raw finding, `applies(intake)` and the stored judgments to give a status:
   - `needs_intake` is first. It means that intake answers are missing. The finding contains the questions.
   - `needs_judgment` is next. It gives a question and the material. Its key is a hash of the content.
   - If not, the finding is `open`, or a judgment answer removes it.

   Only `open` findings make the CLI fail (exit 1). Exit 2 means that the scan could not run. If a detector throws an error, the error stays in its `RuleRun.error` and does not stop the other rules.
4. The finding id is `hash(ruleId, file or page path)`. It does not include line numbers. The CLI gives one finding for each file and each rule. Each location is in the evidence.
5. Intake answers and judgments are in `legal-lint.config.json` at the scanned root. This file is committed. The licence key never goes in this file. Legal Lint refuses a config that has `licenceKey`. The key is in `LEGAL_LINT_KEY` or `~/.legal-lint/key`.

### Rule data files

Each rule has a `legal.yaml` and a `fix.yaml`. The rule imports them as `?raw` text. `rules/src/raw.d.ts` declares this import type, and a tsup esbuild plugin puts the text into the bundle. `defineRule` validates the files with zod.

- `legal.yaml` must be a copy of `RULEBOOK.md`, **word for word**. `tests/rulebook-sync.test.ts` makes this mandatory. Change the rulebook and the yaml together.
- `fix.yaml` is guidance for coding agents. It has the goal, steps with framework variants, "done when" checks, and steps that only the owner can do.

## Fixtures (the core of the test suite)

The fixtures are in `fixtures/<rule>/<name>/`. Each folder has an `expect.json` with these items:

- `mode` (`static` or `runtime`),
- a `description`,
- the expected findings (status, confidence, evidence file and line, request URL, or `absent`).

Runtime fixtures serve a `site/` folder. `tests/fixtures.test.ts` finds the fixtures automatically. The prefix of the folder name sets the category:

- A `fires-*` fixture must give exactly the listed findings. Each one must have a `.fixed` twin. The twin is the same project after a person follows `fix.yaml` manually. A scan of the twin must give no findings.
- `pass-*` and `near-miss-*` fixtures must give no findings.
- `intake-*` and `judgment-*` fixtures test intake answers that are missing or negative, and judgments with and without an answer.
- A test for all rules also makes sure that **no rule** gives an open finding on a pass, near-miss or fixed fixture.

Write detectors for the general case. Never write special code for one fixture. If a detector is not sure, it decreases the confidence or gives no finding. A false alarm costs more than a finding that the detector does not give.

## Rules for text and legal text

- A finding explanation has exactly two sentences. It must not contain violat*, (non-)compliant/compliance, illegal, unlawful, breach* or guarantee* (`tests/helpers/wording.ts`). A finding tells what the detector saw and the risk. It never tells the user that they break the law. It never promises that a fix makes them compliant.
- Exposure figures stay exactly as in the rulebook, with the label `statutory maximum`, `named case` or `consequence`. Do not correct or add to legal figures from memory. Add each doubtful item, and each legal text that we wrote ourselves, to `LEGAL_REVIEW.md`.
- Each report ends with the disclaimer in `core/src/engine.ts`.
- The HTML report is self-contained. It has no scripts and no external fonts, because a report that loads Google Fonts will cause an LL-01 finding.

## Privacy promise (tested)

A repo scan sends only the daily licence check (key and version). `tests/privacy.test.ts` stops all outbound calls during a scan. It fails if the scan sends other data. A hosted URL scan sends only the URL, the key and the version. Do not change this.

## Project conventions

- `CONTRIBUTING.md` has a table that tells which document to update for each type of change. Summary:
  - Each decision that is not obvious gets one line in `DECISIONS.md`, with the reason.
  - Changes that users can see go under "Unreleased" in `CHANGELOG.md`.
  - Bugs that you find but do not fix go in `KNOWN_ISSUES.md`. Remove the entry in the commit that fixes the bug.
- For a new rule, follow `docs/adding-a-rule.md`. To publish the CLI or deploy the API again, follow `RELEASING.md`. To operate the hosted API, follow `packages/api/OPERATIONS.md`.
- Commits: small and conventional (`feat(rules): …`, `fix(LL-02): …`). Local only. Do not add co-author or "generated by" trailers.
- Do not use LLM API calls at any location. LL-02 uses heuristics to decide if an email is marketing or transactional. If the case is not clear, the finding becomes `needs_judgment`. The host agent answers it through MCP `answer_judgment`.
- Static JS/TS detection uses the TypeScript compiler API. It uses only `createSourceFile` syntax trees. It does not use the type checker or ts-morph. For HTML, CSS and config files, the detectors scan the text after they remove the comments.
- These items are not in the scope of this phase. Do not build them or make stubs for them: billing, a web UI, a GitHub App, a fix command, rules LL-06 to LL-15, batch URL scans (milestone 3, not done).
