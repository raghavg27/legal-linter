# Legal Lint

A linter for legal traps in startup codebases and live sites. Each rule is a law founders break by accident, such as Google Fonts leaking visitor IPs in the EU, marketing email with no unsubscribe link, or session replay recording before consent.

Legal Lint reports and guides. It never edits your code: every finding comes with fix guidance that your coding agent applies.

> Status: phase 1, milestone 4. Rules LL-01 to LL-05, the CLI, the HTML report and the MCP server are implemented. Batch URL scans (milestone 3) were skipped for now.

| Rule | Trap | Checks |
|---|---|---|
| LL-01 | Google Fonts loaded from Google's CDN (EU) | repo, live site |
| LL-02 | Marketing email with no unsubscribe or postal address (US) | repo |
| LL-03 | Session replay recording before consent (US) | repo, live site |
| LL-04 | Subscription that renews silently (US) | repo, live site |
| LL-05 | User uploads with no DMCA agent (US) | repo, intake |

## Usage

```sh
legal-lint init [path]          # answer the project questions that decide which rules apply
legal-lint scan [path]          # scan a repository on this machine
legal-lint scan-url <url>       # load a live or preview URL and check what happens before any click
legal-lint mcp                  # start the MCP server for coding agents (stdio)
```

Both scan commands accept `--json`, `--rule LL-01` and `--html [file]`, which also writes a one-page HTML report for the product owner (default `.legal-lint/report.html`; that folder ignores itself in git). `scan-url` also takes `--timeout <ms>`. It visits the URL plus up to four same-origin pricing or legal pages linked from it, and never clicks, types or submits anything. `init` takes `--answers '<json>'` for scripted use and `--force` to answer again.

Exit codes: `0` no open findings, `1` at least one open finding, `2` the scan could not run.

`scan-url` needs Playwright and Chromium: `npm install playwright && npx playwright install chromium`.

## Project answers

Some rules only apply in certain situations, for example when you have EU visitors. `legal-lint init` asks the questions and writes `legal-lint.config.json` at the repo root:

```json
{ "intake": { "countries": ["US", "DE"], "euUkVisitors": true, "sendsMarketingEmail": true } }
```

When an answer is missing, the finding is still shown, with status `needs_intake` and the question to answer. Skipped questions are never treated as "no".

Some findings need judgment the scanner can't make, for example whether an email is marketing or transactional. These have status `needs_judgment`, with the question, the options and the material needed to answer. An answer is stored in the same file and applies until the material changes:

```json
{ "judgments": { "LL-02-56f31f0791": { "answer": "transactional", "contentHash": "9154502ec67e0397", "answeredAt": "2026-10-07T10:00:00Z" } } }
```

## Coding agents (MCP)

`legal-lint mcp` starts a local MCP server on stdio. Claude Code:

```sh
claude mcp add legal-lint -- npx legal-lint mcp
```

Cursor (`.cursor/mcp.json`):

```json
{ "mcpServers": { "legal-lint": { "command": "npx", "args": ["legal-lint", "mcp"] } } }
```

| Tool | What it does |
|---|---|
| `preflight_check` | Before building payments, analytics, email, uploads, auth or fonts: which rules apply and what must be true afterwards |
| `scan_repo` | Every finding in the working tree, with file and lines; writes the HTML report |
| `scan_url` | Runtime findings for a live or preview URL (localhost works); writes the HTML report |
| `get_fix_guidance` | Fix steps picked for the project's framework, plus steps only the owner can do |
| `answer_judgment` | Records the agent's answer to a `needs_judgment` question, with its reason |
| `answer_intake` | Records the user's answers to the project questions |
| `explain_rule` | The trap, the law, the exposure, and whether the rule applies here |

Before the package is published, point the agent at a local build: `pnpm build`, then use `node /path/to/legal-linter/packages/cli/dist/bin.js mcp` as the command.

## What leaves your machine

- `scan` reads your repository locally and sends nothing anywhere. A test enforces this: it intercepts every outbound network call during a scan and fails if anything is sent.
- `scan-url` visits the URL you give it from your machine, the way a browser would.
- The MCP server runs on your machine and uses the same scanner. A test runs a scan through it with every network call blocked.
- HTML reports are written into your project folder and go nowhere else.

## Development

```sh
pnpm install
pnpm test        # unit, fixture, CLI and privacy tests (runtime fixtures use a local server, no network)
pnpm typecheck
pnpm build       # bundles the CLI to packages/cli/dist
```

Each rule lives in `packages/rules/src/<rule>/` with two reviewable data files: `legal.yaml` (copied from `RULEBOOK.md`; a test keeps them in sync) and `fix.yaml` (guidance for coding agents). Fixtures live in `fixtures/<rule>/`, with an `expect.json` in each:

- `fires-*` must produce the findings listed, and each one has a `.fixed` twin that must scan clean.
- `pass-*` and `near-miss-*` must produce nothing.
- `intake-*` check how the rule behaves with missing or negative intake answers.
- `judgment-*` check judgment questions, unanswered and answered.

---

Legal Lint describes what it observed and the risk it may create. It is not legal advice.
