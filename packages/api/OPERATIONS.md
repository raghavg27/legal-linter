# Operating the Legal Lint API

This document tells how to operate the hosted API each day after the first deploy. `DEPLOY.md` gives the setup, the admin commands for keys (section 4) and all the limits (section 8). This file tells what to do after the deploy. Replace `<id>` with the id of the project.

## Keys

```bash
pnpm --filter @legal-lint/api build
GOOGLE_CLOUD_PROJECT=<id> node packages/api/dist/admin.js issue --label founder@example.com [--expires YYYY-MM-DD]
GOOGLE_CLOUD_PROJECT=<id> node packages/api/dist/admin.js list
GOOGLE_CLOUD_PROJECT=<id> node packages/api/dist/admin.js revoke <prefix>
```

- The script shows a key one time only. Firestore keeps only the SHA-256 and the first 8 characters of the key (the prefix). Thus you cannot get back a lost key. You must replace it.
- Users identify a key by the prefix that `legal-lint licence` shows. Use this prefix with `list` and `revoke`.
- Hosted scans refuse a revoked key immediately, because each scan checks the key. Local scans stop at the next licence check of the client. This occurs a maximum of one day later, because the CLI keeps a valid result in its cache for 24 hours. The "invalid" answer then clears the cache.
- Make sure that the date for `--expires` is correct (see `KNOWN_ISSUES.md`).

## Logs

The API writes one JSON line for each request to stdout:

| Field | Meaning |
|---|---|
| `route` | `licence` or `scan` |
| `outcome` | `valid`, a key problem, a refusal reason (see the table below), or the scan result |
| `keyPrefix` | The first 8 characters of the key, when the API knows them |
| `host` | The host of the scanned site (only scans, never the full URL) |
| `ms` | The duration of the scan (only scans) |

```bash
gcloud run services logs read legal-lint-api --region us-central1 --limit 100
```

`forwardedFor` shows only while `LOG_FORWARDED_FOR=1` is set (`DEPLOY.md` section 6). After you use it, turn it off, because it records IP addresses. The request logs are in the legal review queue (`LEGAL_REVIEW.md`).

## Error reasons

Each refusal is `{"error":{"reason","message"}}`. The CLI and the MCP tools show the message to the user.

| Reason | HTTP | Cause | Action |
|---|---|---|---|
| `bad_request` | 400, 413 | The body is not the expected JSON, or it is larger than 4 KB. | Usually the client is old or changed. |
| `bad_url` | 400 | The API cannot scan the URL (not http/https, incorrect port, cannot resolve). | When the host does not resolve, the message tells the user to use `--local`. |
| `private_address` | 400 | The URL or its DNS answer is a private, loopback or metadata address. | This is the correct behaviour. The user scans with `--local`. |
| `unauthorized` | 401 | A scan with a key that is missing, unknown, revoked or expired. (A licence check answers `{"valid":false,"reason"}` with 200.) | `admin.js list` shows the status of the key by its prefix. |
| `too_many_requests` | 429 | The limit for each IP address on licence checks or failed keys. | Wait until the hour ends. If many users share one address, examine `TRUSTED_PROXY_HOPS`. |
| `key_hour`, `key_day` | 429 | The key used all its hosted scans for the hour or the day. | Wait, use `--local`, or increase `SCANS_PER_KEY_HOUR` / `SCANS_PER_KEY_DAY`. |
| `monthly_budget` | 503 | The service used all of `SCANS_PER_MONTH`. | Scans start again next month (UTC). Increase the limit only after you examine the bill. |
| `busy` | 503 | `MAX_RUNNING_SCANS` scans run and `MAX_WAITING_SCANS` scans wait. | This is temporary. If `busy` continues, the scans are slow. Examine `ms` in the logs. |
| `scan_failed` | 502 | Chromium could not load the site, or the scan went over `SCAN_DEADLINE_MS`. | The cause is frequently the site. To compare, try `--local`. |
| `internal` | 500 | An error that the code does not handle. | The API does not log the error at this time (`KNOWN_ISSUES.md`). Do the error again locally: start the Firestore emulator (`DEPLOY.md` section 9). Then run `pnpm build:api` and `PORT=8081 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GOOGLE_CLOUD_PROJECT=legal-lint-test node packages/api/dist/server.js`. |

## Usage and cost

- **Scans in this month:** the `usage/month_<yyyy-mm>` document in the Firestore console.
- **Cost:** Billing → Reports, grouped by SKU. The $1 budget alert only sends email (`DEPLOY.md` section 1).
- **Health:** `curl <url>/healthz` returns `{"ok":true}`.
- **Stored images:** `DEPLOY.md` section 7. The cleanup policy keeps one image.

## Change a limit

```bash
gcloud run services update legal-lint-api --region us-central1 --update-env-vars SCANS_PER_KEY_DAY=100
```

`DEPLOY.md` section 8 gives the variables and their defaults. Do not increase `--max-instances` above 1 before you move these two items out of the process memory: the limits for each IP address and the memory of keys that are over the limit (`KNOWN_ISSUES.md`).
