# Changelog

User-visible changes to the `legal-lint` package and the hosted API. Newest first. Add every change under "Unreleased"; `RELEASING.md` says how to cut a version.

## Unreleased

### 0.1.0 (not yet published)

First release: phase 1, rules LL-01 to LL-05.

**Rules**

- LL-01 Google Fonts loaded from Google's CDN (static and runtime).
- LL-02 Marketing email with no unsubscribe or postal address (static). Unclear marketing-or-transactional cases are asked as judgment questions.
- LL-03 Session replay recording before consent (static and runtime). Covers FullStory, Hotjar, LogRocket, Clarity and PostHog.
- LL-04 Subscription that renews silently (static and runtime).
- LL-05 User uploads with no DMCA agent (static and intake).

**CLI**

- `scan`, `scan-url`, `init`, `mcp`, `activate` and `licence` commands.
- Text and `--json` output, `--rule`, and `--html` for a one-page report for the product owner.
- Exit codes: 0 no open findings, 1 open findings, 2 the scan could not run.
- Intake answers and judgment answers stored in `legal-lint.config.json`.

**MCP server** (`legal-lint mcp`, stdio)

- Tools: `preflight_check`, `scan_repo`, `scan_url`, `get_fix_guidance`, `answer_judgment`, `answer_intake`, `explain_rule`.

**Licence and hosted API**

- A licence key is required for scans and MCP tools (no free tier). The key is checked at most once a day, with a 7-day grace when the server cannot be reached.
- Public URLs are scanned by the hosted scanner, which returns the recording; the rules run locally. Localhost, private addresses and `--local` scan on the user's machine.
- Hosted API on Cloud Run with Firestore. It refuses private targets, applies per-key, per-IP and monthly limits, enforces a 60 s hard deadline per scan, and gzips results with per-page size caps.
