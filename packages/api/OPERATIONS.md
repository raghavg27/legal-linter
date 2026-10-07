# Operating the Legal Lint API

Day-to-day running of the hosted API after the first deploy. `DEPLOY.md` covers the setup, the key admin commands (section 4) and every limit (section 8); this file covers what happens afterwards. Replace `<id>` with the project id.

## Keys

```bash
pnpm --filter @legal-lint/api build
GOOGLE_CLOUD_PROJECT=<id> node packages/api/dist/admin.js issue --label founder@example.com [--expires YYYY-MM-DD]
GOOGLE_CLOUD_PROJECT=<id> node packages/api/dist/admin.js list
GOOGLE_CLOUD_PROJECT=<id> node packages/api/dist/admin.js revoke <prefix>
```

- A key is printed once. Firestore keeps only its SHA-256 and its first 8 characters (the prefix), so a lost key is replaced, never recovered.
- Users identify a key by the prefix that `legal-lint licence` shows. Use it with `list` and `revoke`.
- A revoked key is refused by hosted scans at once, because every scan checks the key. Local scans stop at the client's next licence check, at most a day later, because the CLI caches a valid result for 24 hours. The "invalid" answer then clears the cache.
- Check the date you pass to `--expires` (see `KNOWN_ISSUES.md`).

## Logs

The API writes one JSON line per request to stdout:

| Field | Meaning |
|---|---|
| `route` | `licence` or `scan` |
| `outcome` | `valid`, a key problem, a refusal reason (table below), or the scan result |
| `keyPrefix` | First 8 characters of the key, when known |
| `host` | Host of the scanned site (scans only, never the full URL) |
| `ms` | Scan duration (scans only) |

```bash
gcloud run services logs read legal-lint-api --region us-central1 --limit 100
```

`forwardedFor` appears only while `LOG_FORWARDED_FOR=1` is set (`DEPLOY.md` section 6). Turn it off afterwards, because it records IP addresses. Request logs are in the legal review queue (`LEGAL_REVIEW.md`).

## Error reasons

Every refusal is `{"error":{"reason","message"}}`. The CLI and MCP tools show the message to the user.

| Reason | HTTP | Cause | What to do |
|---|---|---|---|
| `bad_request` | 400, 413 | Body is not the expected JSON, or is over 4 KB | Usually an old or modified client |
| `bad_url` | 400 | The URL cannot be scanned (not http/https, bad port, cannot resolve) | The message points to `--local` when the host does not resolve |
| `private_address` | 400 | The URL or its DNS answer is a private, loopback or metadata address | Working as intended. The user scans with `--local`. |
| `unauthorized` | 401 | Scan with a key that is missing, unknown, revoked or expired. (A licence check answers `{"valid":false,"reason"}` with 200 instead.) | `admin.js list` shows the key's status by prefix |
| `too_many_requests` | 429 | Per-IP limit on licence checks or failed keys | Waits out the hour. If many users share one address, check `TRUSTED_PROXY_HOPS`. |
| `key_hour`, `key_day` | 429 | The key used its hourly or daily hosted scans | Wait, use `--local`, or raise `SCANS_PER_KEY_HOUR` / `SCANS_PER_KEY_DAY` |
| `monthly_budget` | 503 | The service used `SCANS_PER_MONTH` | Scans resume next month (UTC). Raise the cap only after checking the bill. |
| `busy` | 503 | `MAX_RUNNING_SCANS` running and `MAX_WAITING_SCANS` waiting | Transient. Persistent `busy` means scans are slow; check `ms` in the logs. |
| `scan_failed` | 502 | Chromium could not load the site, or the scan passed `SCAN_DEADLINE_MS` | Often the site itself. Try `--local` to compare. |
| `internal` | 500 | Unhandled error | The error itself is not logged yet (`KNOWN_ISSUES.md`). Reproduce it locally: start the Firestore emulator (`DEPLOY.md` section 9), then `pnpm build:api` and `PORT=8081 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GOOGLE_CLOUD_PROJECT=legal-lint-test node packages/api/dist/server.js`. |

## Usage and cost

- **Scans this month:** the `usage/month_<yyyy-mm>` document in the Firestore console.
- **Spend:** Billing → Reports, grouped by SKU. The $1 budget alert only sends email (`DEPLOY.md` section 1).
- **Health:** `curl <url>/healthz` returns `{"ok":true}`.
- **Stored images:** `DEPLOY.md` section 7. The cleanup policy keeps one.

## Changing a limit

```bash
gcloud run services update legal-lint-api --region us-central1 --update-env-vars SCANS_PER_KEY_DAY=100
```

The variables and their defaults are in `DEPLOY.md` section 8. Do not raise `--max-instances` above 1 without moving the per-IP limits and the over-limit memory out of process memory (`KNOWN_ISSUES.md`).
