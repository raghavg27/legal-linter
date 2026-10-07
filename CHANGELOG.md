# Changelog

This file gives the changes that users can see in the `legal-lint` package and the hosted API. The newest changes are first. Add each change under "Unreleased". `RELEASING.md` tells how to make a version.

## Unreleased

### 0.1.0 (not published)

First release: phase 1, rules LL-01 to LL-05.

**Rules**

- LL-01: Google Fonts loaded from the Google CDN (static and runtime).
- LL-02: Marketing email with no unsubscribe link or no postal address (static). If it is not clear that an email is marketing or transactional, the rule asks a judgment question.
- LL-03: Session replay records before consent (static and runtime). The rule finds FullStory, Hotjar, LogRocket, Clarity and PostHog.
- LL-04: Subscription renews and the customer is not told (static and runtime).
- LL-05: User uploads with no DMCA agent (static and intake).

**CLI**

- Commands: `scan`, `scan-url`, `init`, `mcp`, `activate` and `licence`.
- Text output and `--json` output, `--rule`, and `--html` for a one-page report for the product owner.
- Exit codes: 0 for no open findings, 1 for open findings, 2 when the scan could not run.
- `legal-lint.config.json` keeps the intake answers and the judgment answers.

**MCP server** (`legal-lint mcp`, stdio)

- Tools: `preflight_check`, `scan_repo`, `scan_url`, `get_fix_guidance`, `answer_judgment`, `answer_intake`, `explain_rule`.

**Licence and hosted API**

- Scans and MCP tools need a licence key. There is no free tier. Legal Lint checks the key a maximum of one time each day. If it cannot connect to the server, it continues to operate for 7 days.
- The hosted scanner scans public URLs and returns the recording. The rules run on the machine of the user. Localhost, private addresses and `--local` scan on the machine of the user.
- The hosted API runs on Cloud Run with Firestore. It refuses private targets. It applies limits for each key, for each IP address and for each month. It stops each scan after a hard deadline of 60 s. It compresses the results with gzip and limits the size of each page.
