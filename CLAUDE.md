# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Legal Lint: a linter for legal traps in startup codebases and live sites (rules LL-01 to LL-05 of `RULEBOOK.md`). It **reports and guides, never edits code**. The main consumer is a coding agent calling it through the MCP server. The original brief is `CLAUDE_CODE_PROMPT.md`, but `DECISIONS.md` overrides it where they differ. For example, there is **no free tier**, and MCP returns all findings, not just the top few.

## Commands

pnpm workspace, Node >= 20 (the API needs 22), pnpm 10.34.6 is pinned.

```sh
pnpm install
pnpm test                                   # vitest: tests/** and packages/*/src/**/*.test.ts
pnpm vitest run tests/fixtures.test.ts      # one file
pnpm vitest run -t "LL-01 fires-html"       # filter by test name (fixture tests are named "<rule> <fixture>: <description>")
pnpm typecheck                              # tsc --noEmit over every package and tests
pnpm build                                  # bundles the CLI to packages/cli/dist (tsup)
pnpm build:api                              # bundles the hosted API to packages/api/dist
node packages/cli/dist/bin.js scan <path>   # run the built CLI
```

- Runtime fixture tests and the egress tests need Playwright's Chromium (`npx playwright install chromium`). They never touch the network: sites are served from 127.0.0.1.
- `tests/mcp-stdio.test.ts` runs the built `packages/cli/dist/bin.js` over real stdio.
- `packages/api/src/firestore-store.test.ts` only runs when `FIRESTORE_EMULATOR_HOST` is set.
- `tests/setup/licence.ts` makes every test licensed by default: a temp `LEGAL_LINT_HOME` holding a key and a fresh cache, and `LEGAL_LINT_API_URL` pointing at a dead port. Tests of the licence gate build their own home.

## Architecture

Packages in `packages/`:

- **core** (`@legal-lint/core`, private, consumed as TS source through `exports`). Holds the engine (`engine.ts`: `scanRepo`, `scanSite`, `evaluateCapture`), the types and zod schemas, intake/config (`intake.ts`), judgments, fix-guidance selection, preflight topic matching, the text/HTML reports, the Playwright crawler (`runtime/crawler.ts`), static helpers (`static/`: TS compiler API ASTs, repo index, file kinds, routes) and the SSRF address checks (`net/address.ts`).
- **rules** (`@legal-lint/rules`). One folder per rule (`LL-0N-<slug>/`). `index.ts` calls `defineRule({ meta, legalYaml, fixYaml, applies, detectStatic?, detectRuntime? })`. `src/index.ts` exports the `rules` array. Shared applicability and email helpers live in `shared/`.
- **cli** (the published `legal-lint` npm package). Holds the commander program (`program.ts`: init, scan, scan-url, mcp, activate, licence), the MCP stdio server (`mcp/`, MCP SDK v2 `@modelcontextprotocol/server`, loaded only by the `mcp` command), and the licence gate (`licence/`). tsup bundles core and rules in. Playwright is an optional, external dependency loaded with a dynamic import.
- **api** (`@legal-lint/api`, Hono on Cloud Run with Firestore). Validates licence keys and runs hosted URL scans. Rate limits, a monthly cap, a per-scan deadline and an in-process egress proxy (`egress/`) for SSRF defence. Admin key issuing is in `admin.ts`. It imports core only through subpaths (`@legal-lint/core/crawler`, `/remote`, `/address`) so the TypeScript compiler stays out of the bundle. Deploy steps are in `packages/api/DEPLOY.md`. `DEFAULT_API_URL` in `cli/src/licence/api.ts` stays empty until the first deploy.

### How a scan flows

1. Static scans build a `RepoIndex` once. It skips gitignored paths, node_modules and build output, tests, fixtures, minified files and files over 1 MB. Each rule's `detectStatic` returns `RawFinding`s.
2. Runtime scans: the crawler records one `SiteCapture`. It covers the start URL plus up to 4 same-origin pricing or legal links, and it never clicks, types or submits. Each rule's `detectRuntime(capture)` is a pure function of that recording. For public URLs the **hosted API records and the CLI judges**: the API returns only the raw capture, and the rules run locally with local intake and judgments. Localhost, private addresses and `--local` always crawl on the machine.
3. `engine.ts` `toFinding` combines the raw finding with `applies(intake)` and stored judgments into a status:
   - `needs_intake` comes first: missing intake answers, with the questions attached.
   - Next is `needs_judgment`: a question plus the material, keyed by content hash.
   - Otherwise the finding is `open`, or it is dropped by a judgment answer.

   Only `open` findings fail the CLI (exit 1). Exit 2 means the scan could not run. A detector that throws is isolated in its `RuleRun.error`.
4. Finding id is `hash(ruleId, file or page path)`, without line numbers. The CLI reports one finding per file per rule, with every location as evidence.
5. Intake answers and judgments live in the committed `legal-lint.config.json` at the scanned root. The licence key never goes there: a config with `licenceKey` is refused. The key lives in `LEGAL_LINT_KEY` or `~/.legal-lint/key`.

### Rule data files

Each rule has `legal.yaml` and `fix.yaml`, imported as `?raw` text (declared in `rules/src/raw.d.ts`, inlined by a tsup esbuild plugin) and validated with zod in `defineRule`.

- `legal.yaml` must copy `RULEBOOK.md` **word for word**. `tests/rulebook-sync.test.ts` enforces this. Change the rulebook and the yaml together.
- `fix.yaml` is guidance written for coding agents: goal, steps with framework variants, "done when" checks, and owner-only steps.

## Fixtures (the core of the test suite)

`fixtures/<rule>/<name>/`. Each folder has an `expect.json` with `mode` (`static` or `runtime`), a `description` and the expected findings (status, confidence, evidence file and line, request URL, or `absent`). Runtime fixtures serve a `site/` folder. `tests/fixtures.test.ts` discovers them automatically. The folder name prefix sets the category:

- `fires-*` must produce exactly the listed findings, and each needs a `.fixed` twin (the same project after following `fix.yaml` by hand) that scans clean.
- `pass-*` and `near-miss-*` must produce nothing.
- `intake-*` and `judgment-*` cover missing or negative intake answers, and unanswered or answered judgments.
- A cross-rule test also checks that **no rule** reports an open finding on any pass, near-miss or fixed fixture.

Write detectors for the general case and never special-case a fixture. When unsure, a detector lowers confidence or stays silent: a false alarm costs more than a missed finding.

## Rules for wording and legal text

- A finding explanation is exactly two sentences, and it must not contain violat*, (non-)compliant/compliance, illegal, unlawful, breach* or guarantee* (`tests/helpers/wording.ts`). Findings describe what was observed and the risk. They never say the user is breaking the law, and never promise that a fix makes them compliant.
- Exposure figures stay exactly as in the rulebook, labelled `statutory maximum`, `named case` or `consequence`. Do not correct or extend legal figures from memory. Add anything doubtful, and any legal-facing text we wrote ourselves, to `LEGAL_REVIEW.md`.
- Every report ends with the disclaimer in `core/src/engine.ts`.
- The HTML report is self-contained: no scripts and no external fonts, because a report that loads Google Fonts would trip LL-01.

## Privacy promise (tested)

A repo scan sends nothing except the daily licence check (key and version). `tests/privacy.test.ts` intercepts outbound calls during a scan and fails if anything else is sent. A hosted URL scan sends only the URL, key and version. Keep it that way.

## Project conventions

- `CONTRIBUTING.md` has the table of which document to update for which change. In short:
  - every non-obvious choice gets one line in `DECISIONS.md`, with the reason;
  - user-visible changes go under "Unreleased" in `CHANGELOG.md`;
  - bugs found but not fixed go in `KNOWN_ISSUES.md`, and the entry is removed in the commit that fixes it.
- New rule: follow `docs/adding-a-rule.md`. Publishing the CLI or redeploying the API: `RELEASING.md`. Running the hosted API: `packages/api/OPERATIONS.md`.
- Commits: small, conventional (`feat(rules): …`, `fix(LL-02): …`), local only, with no co-author or generated-by trailers.
- No LLM API calls anywhere. LL-02 handles the marketing-or-transactional question with heuristics, and the unclear cases become `needs_judgment` for the host agent to answer through MCP `answer_judgment`.
- Static JS/TS detection uses the TypeScript compiler API (`createSourceFile` syntax trees only, no type checker, no ts-morph). HTML, CSS and config files use text scanning with comments stripped.
- Not in scope for this phase, so don't build or stub them: billing, a web UI, a GitHub App, a fix command, rules LL-06 to LL-15, batch URL scans (milestone 3, skipped).
