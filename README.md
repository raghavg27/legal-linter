# Legal Lint

A linter for legal traps in startup codebases and live sites. Each rule is a law founders break by accident, such as Google Fonts leaking visitor IPs in the EU, marketing email with no unsubscribe link, or session replay recording before consent.

Legal Lint reports and guides. It never edits your code: every finding comes with fix guidance that your coding agent applies.

> Status: phase 1, milestone 1. One rule (LL-01) is implemented, statically and at runtime.

## Usage

```sh
legal-lint scan [path]          # scan a repository on this machine
legal-lint scan-url <url>       # load a live or preview URL and check what happens before any click
```

Both commands accept `--json` and `--rule LL-01`. `scan-url` also takes `--timeout <ms>`.

Exit codes: `0` no open findings, `1` at least one open finding, `2` the scan could not run.

`scan-url` needs Playwright and Chromium: `npm install playwright && npx playwright install chromium`.

## Project answers

Some rules only apply in certain situations, for example when you have EU visitors. Put the answers in `legal-lint.config.json` at the repo root:

```json
{ "intake": { "euUkVisitors": true, "countries": ["US", "DE"] } }
```

When an answer is missing, the finding is still shown, with status `needs_intake` and the question to answer.

## What leaves your machine

- `scan` reads your repository locally and sends nothing anywhere. A test enforces this: it intercepts every outbound network call during a scan and fails if anything is sent.
- `scan-url` visits the URL you give it from your machine, the way a browser would.

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

---

Legal Lint describes what it observed and the risk it may create. It is not legal advice.
