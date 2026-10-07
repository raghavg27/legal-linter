# Legal Lint

Legal Lint is a linter. It finds legal traps in startup codebases and live sites. Each rule is about a law that founders break by accident. Examples:

- Google Fonts send the IP addresses of visitors in the EU to Google.
- A marketing email has no unsubscribe link.
- Session replay records visitors before they give consent.

Legal Lint reports and gives guidance. It does not edit your code. Each finding has fix guidance. Your coding agent applies the guidance.

> Status: phase 1, milestone 5. These items are complete: rules LL-01 to LL-05, the CLI, the HTML report, the MCP server, licence keys and the hosted scanner. Batch URL scans (milestone 3) are not done at this time.

| Rule | Trap | Checks |
|---|---|---|
| LL-01 | Google Fonts loaded from the Google CDN (EU) | repo, live site |
| LL-02 | Marketing email with no unsubscribe link or no postal address (US) | repo |
| LL-03 | Session replay records before consent (US) | repo, live site |
| LL-04 | Subscription renews and the customer is not told (US) | repo, live site |
| LL-05 | User uploads with no DMCA agent (US) | repo, intake |

## Usage

```sh
legal-lint init [path]          # answer the project questions. The answers decide which rules apply.
legal-lint scan [path]          # scan a repository on this machine
legal-lint scan-url <url>       # load a live or preview URL. Examine what occurs before a click.
legal-lint mcp                  # start the MCP server for coding agents (stdio)
legal-lint activate <key>       # make sure that a licence key is valid, then keep it for this user
legal-lint licence              # show the licence key in use and the time of the last check
```

The two scan commands accept these options:

- `--json`
- `--rule LL-01`
- `--html [file]`. This option also writes a one-page HTML report for the product owner. The default file is `.legal-lint/report.html`. Legal Lint puts a `.gitignore` file in that folder, thus git ignores the folder.

`scan-url` also accepts `--timeout <ms>` and `--local`.

- The Legal Lint hosted scanner loads public URLs.
- Localhost and private addresses always load on your machine.
- `--local` makes all URLs load on your machine.

The scanner opens the URL. It also opens a maximum of four pricing or legal pages that the URL links to on the same origin. It does not click, type or submit.

`init` accepts `--answers '<json>'` for scripts, and `--force` to answer the questions again.

Exit codes:

- `0`: There are no open findings.
- `1`: There is one or more open finding.
- `2`: The scan could not run.

You need Playwright and Chromium only for `--local` and for localhost or private addresses. To install them, run `npm install playwright && npx playwright install chromium`.

## Licence key

Legal Lint needs a licence key. There is no free tier.

- `legal-lint activate <key>` makes sure that the key is valid. Then it keeps the key in `~/.legal-lint/key`. Only you can read this file. `LEGAL_LINT_KEY` overrides this file. Use `LEGAL_LINT_KEY` in CI.
- `legal-lint licence` shows the key in use and the time of the last check.
- If there is no key, `scan`, `scan-url` and the MCP tools stop and tell you what to do. `init`, `--help` and `--version` continue to operate.
- Legal Lint checks the key a maximum of one time each day. If Legal Lint cannot connect to the licence server, it continues to operate for 7 days after the last good check.
- Do not put the key in `legal-lint.config.json`. You commit that file. Legal Lint refuses a config that contains `licenceKey`.

## Project answers

Some rules apply only in some conditions, for example when you have visitors from the EU. `legal-lint init` asks the questions. Then it writes `legal-lint.config.json` at the root of the repo:

```json
{ "intake": { "countries": ["US", "DE"], "euUkVisitors": true, "sendsMarketingEmail": true } }
```

If an answer is missing, Legal Lint still shows the finding. The finding has the status `needs_intake` and the question to answer. Legal Lint never thinks that a question you did not answer means "no".

For some findings, the scanner cannot make the decision. For example, it cannot always know if an email is marketing or transactional. These findings have the status `needs_judgment`. They give the question, the options and the material that you need for the answer. Legal Lint keeps the answer in the same file. The answer stays valid until the material changes:

```json
{ "judgments": { "LL-02-56f31f0791": { "answer": "transactional", "contentHash": "9154502ec67e0397", "answeredAt": "2026-10-07T10:00:00Z" } } }
```

## Coding agents (MCP)

`legal-lint mcp` starts a local MCP server on stdio. For Claude Code:

```sh
claude mcp add legal-lint -- npx legal-lint mcp
```

For Cursor (`.cursor/mcp.json`):

```json
{ "mcpServers": { "legal-lint": { "command": "npx", "args": ["legal-lint", "mcp"] } } }
```

| Tool | Function |
|---|---|
| `preflight_check` | Use it before you build payments, analytics, email, uploads, auth or fonts. It tells which rules apply and which conditions must be true after the work. |
| `scan_repo` | Gives all findings in the working tree, with the file and the lines. Writes the HTML report. |
| `scan_url` | Gives the runtime findings for a live or preview URL. Localhost loads on your machine. Public URLs use the hosted scanner. `local: true` makes the URL load on your machine. Writes the HTML report. |
| `get_fix_guidance` | Gives the fix steps for the framework of the project. Also gives the steps that only the owner can do. |
| `answer_judgment` | Records the answer of the agent to a `needs_judgment` question, with the reason. |
| `answer_intake` | Records the answers of the user to the project questions. |
| `explain_rule` | Tells the trap, the law and the exposure. Also tells if the rule applies to this project. |

Before the package is published, use a local build for the agent. Run `pnpm build`. Then use `node /path/to/legal-linter/packages/cli/dist/bin.js mcp` as the command.

## Data that goes out of your machine

- `scan` reads your repository on your machine. The only network call is the licence check. This check occurs a maximum of one time each day. It sends your licence key and the Legal Lint version. A test stops each outbound call during a scan. The test fails if the scan sends other data.
- `scan-url` on a public URL sends the URL, your key and the version to the Legal Lint scanner. The scanner loads the page in its own browser. Then it sends back the data that it recorded. Your intake answers and judgments stay on your machine. The rules run on your machine. The scanner logs the first 8 characters of the key, the host of the site, the result and the duration. It does not log the full URL.
- `scan-url` on localhost or on a private address, or with `--local`, runs Chromium on your machine. It sends nothing to us.
- The MCP server runs on your machine and uses the same paths.
- HTML reports stay in your project folder.

## Development

```sh
pnpm install
pnpm test        # unit, fixture, CLI and privacy tests. Runtime fixtures use a local server, not the network.
pnpm typecheck
pnpm build       # bundles the CLI to packages/cli/dist
pnpm build:api   # bundles the hosted API to packages/api/dist
```

The hosted service is in `packages/api`. It does the licence checks and the public URL scans. To deploy it, follow `packages/api/DEPLOY.md`.

For diagrams that show how the parts connect, read `docs/architecture.md`.

Before you change code, read `CONTRIBUTING.md`. It tells which document to update for each type of change. Other documents:

- To add a rule: `docs/adding-a-rule.md`.
- To release: `RELEASING.md`.
- Open bugs and limits: `KNOWN_ISSUES.md`.

Each rule is in `packages/rules/src/<rule>/`. Each rule has two data files that persons can review:

- `legal.yaml` is a copy of the text in `RULEBOOK.md`. A test makes sure that the two files stay the same.
- `fix.yaml` is the guidance for coding agents.

The fixtures are in `fixtures/<rule>/`. Each fixture has an `expect.json` file.

- `fires-*` fixtures must give the listed findings. Each `fires-*` fixture has a `.fixed` twin. A scan of the twin must give no findings.
- `pass-*` and `near-miss-*` fixtures must give no findings.
- `intake-*` fixtures examine the rule when intake answers are missing or negative.
- `judgment-*` fixtures examine judgment questions, with and without an answer.

---

Legal Lint describes what it observed and the risk it may create. It is not legal advice.
