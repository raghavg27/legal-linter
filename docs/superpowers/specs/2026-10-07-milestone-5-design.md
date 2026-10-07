# Milestone 5: hosted API and licence keys

Status: approved in chat on 2026-10-07 (decisions 1 to 11 below). This spec records them for review.

## Goal

1. A small hosted service with two jobs: validate licence keys, and load public URLs in Chromium for users who do not have it installed.
2. A licence gate in the CLI and the MCP server. There is no free tier: without a valid key, scans and MCP tools refuse to run (owner decision, 2026-10-06).

The hosting must stay inside Google Cloud's free quota. The owner has no budget, so cost limits are part of the design, not an afterthought.

## What does not change

- Repository scans run locally. Source code, file paths, intake answers and judgments never leave the machine.
- The only data sent to the API is the licence key, the package version and, for URL scans, the URL.
- Rules ship inside the local package. No obfuscation and no anti-tamper code.

## Decisions

1. **The server records, the client judges.** `POST /v1/scan` returns a `SiteCapture` (requests, cookies, page text and HTML, links). The CLI runs the runtime rules over it with `evaluateCapture`, using the local intake and judgments. Running rules on the server would mean sending intake answers.
2. **Public URLs go to the API; local ones stay local.** `localhost`, `*.localhost` and IP literals in private, loopback or link-local ranges are scanned with local Chromium. `--local` (CLI) and `local: true` (MCP `scan_url`) force a local scan. If the API refuses a URL as private (for example an internal hostname), the error says to use `--local`.
3. **The key never lives in the project config.** `legal-lint.config.json` is committed. The key comes from `LEGAL_LINT_KEY`, otherwise from `~/.legal-lint/key` written by `legal-lint activate <key>` (file mode 0600). A config that still has `licenceKey` is refused with a message saying where to move it.
4. **Cache and grace.** A valid answer is cached for 24 hours in `~/.legal-lint/licence.json`, keyed by a hash of the key, so a scan normally makes no network call. After 24 hours the client checks again. If the API is unreachable (network error, timeout or 5xx), the tool keeps working with a warning for up to 7 days after the last successful check. A definite "invalid", "revoked" or "expired" answer deletes the cache and stops the tool at once.
5. **What runs without a key:** `--help`, `--version`, `init`, `activate` and `licence` (shows where the key came from, masked, last check, valid until, grace state). `scan` and `scan-url` exit 2 with a message on how to set a key. The MCP server still starts and lists its tools; every tool call returns an error with the same message, so the agent can tell the user what to do.
6. **Host: Google Cloud Run in us-central1**, request-based billing, max 1 instance, min 0, 1 vCPU, 2 GiB, request timeout 120 s, allow unauthenticated (auth is our key). The image is Node slim plus Playwright's Chromium headless shell only, aiming to stay under Artifact Registry's 0.5 GB free storage; old images are deleted. The service runs as its own service account with only Firestore access. Deployment is done by the owner from a script and a written guide; the guide starts with a $1 budget alert.
7. **Keys:** `ll_` followed by 32 random base62 characters (about 190 bits). Firestore stores the SHA-256 of the key as the document id, never the key. Each key document holds the first 8 characters of the key (for display and `revoke`), a label (who it is for), created, expires (optional) and revoked (optional) dates. An admin script run on the owner's laptop with `gcloud auth application-default login` can `issue --label <text> [--expires YYYY-MM-DD]`, `list` and `revoke <prefix>`. `issue` prints the key once.
8. **Cost limits:**
   - A hard cap of 1,500 scans per calendar month (UTC) for the whole service. A scan is capped at 60 seconds. Worst case, 1,500 scans use 90,000 vCPU-seconds and 180,000 GiB-seconds, half the free quota (180,000 and 360,000).
   - Per key: 10 scans per hour and 50 per day (fixed UTC windows).
   - Per IP, in memory (safe with one instance): 30 licence checks per hour and 10 failed authentications per hour. A scan without a valid key is refused with 401 before Chromium starts.
   - At most 2 scans run at once; up to 4 wait; beyond that, 503 with `Retry-After`.
   - A scan counts against the limits when Chromium starts, whether or not the page loads, since the compute is spent either way.
   - When the monthly cap is used up, the API answers 503 with `reason: "monthly_budget"` and the CLI suggests `--local`.
   - All limits are environment variables.
9. **SSRF protection, three layers:**
   - *Input:* http or https only, no username or password in the URL, ports 80 and 443 only, and every address the hostname resolves to must be public unicast.
   - *Egress proxy:* Chromium is launched with a proxy that runs inside the API process. Every connection Chromium makes, including redirects, subresources, iframes and websockets, goes through it. The proxy resolves the hostname itself, refuses if any address is not public unicast, and connects to the address it checked, so DNS rebinding cannot swap it. Refused ranges include loopback, private, link-local (Cloud Run's metadata server at 169.254.169.254), unique-local and Google-internal IPv6, carrier-grade NAT, multicast, reserved and unspecified, plus IPv4 addresses embedded in IPv6 (mapped, 6to4, Teredo).
   - *Chromium flags:* `--proxy-bypass-list=<-loopback>` removes Chromium's built-in exception that sends localhost around the proxy. WebRTC is limited to proxied traffic and QUIC is disabled, so nothing leaves outside the proxy.
10. **API URL:** the client reads `LEGAL_LINT_API_URL`. The default is set in code after the first deploy, when Cloud Run gives the URL. Until then, a missing URL is a clear error.
11. **Tests:** see Testing.

## Architecture

```
packages/
  core/   + src/remote.ts         wire format: zod schemas for the API's requests and responses, SiteCapture included
  cli/    + src/licence/          key lookup, cache, grace, API client, the gate
          + src/remote-scan.ts    POST /v1/scan, validate the capture, then evaluateCapture locally
          ~ program.ts            gate on scan and scan-url; new activate and licence commands; --local
          ~ mcp/server.ts         gate on every tool; scan_url gets `local`
  api/    (new, private, not published to npm)
          src/app.ts              Hono app: routes, auth, limits; dependencies injected
          src/store.ts            KeyStore + UsageStore interfaces; memory and Firestore implementations
          src/limits.ts           per-IP limiter, scan queue
          src/egress/policy.ts    is this address allowed (ipaddr.js)
          src/egress/proxy.ts     HTTP and CONNECT proxy that resolves, checks and connects
          src/scan.ts             launch Chromium with the proxy and flags, captureSite with a 60 s budget
          src/server.ts           entry point for Cloud Run (PORT)
          src/admin.ts            issue, list, revoke
          Dockerfile, deploy.sh, DEPLOY.md
```

Core gains no licence logic. The API package reuses `captureSite` from core with an injected browser.

## API

| Method and path | Auth | Body | Answer |
|---|---|---|---|
| `POST /v1/licence` | none (IP limited) | `{ key, version }` | 200 `{ valid: true, expiresAt }` or 200 `{ valid: false, reason: "unknown" \| "revoked" \| "expired" }` |
| `POST /v1/scan` | `Authorization: Bearer <key>` | `{ url, version }` | 200 `{ capture }`; 400 bad or private URL; 401 bad key; 429 key limit (`Retry-After`); 503 busy or `monthly_budget` |
| `GET /healthz` | none | | 200 |

Errors are `{ error: { reason, message } }`. Bodies over 4 KB are refused. Nothing is logged except the key prefix, the URL host, the outcome and the duration.

## Client flow

1. Gated command starts → find key (env, then file). None → exit 2 with instructions.
2. Cache for this key checked within 24 hours and valid → go.
3. Otherwise `POST /v1/licence`. Valid → write cache and go. Invalid → delete cache, exit 2 with the reason.
4. API unreachable → last success within 7 days → go with a warning on stderr; otherwise exit 2.
5. `scan-url`: local or remote per decision 2. Remote → `POST /v1/scan`, validate the capture with zod, `evaluateCapture` with local intake and judgments, then the usual output and HTML report.

## Testing

- **Egress policy:** a table of addresses (IPv4 and IPv6, every refused range, embedded IPv4, public examples) with the expected answer.
- **Proxy, with real sockets:** an "allowed" fixture server and an "internal" server on 127.0.0.1, with a test policy that allows only the fixture port. Through Chromium and the proxy, a redirect, an image, an iframe and a websocket pointing at the internal server are all refused, and the internal server receives zero connections. A resolver that answers public first and private second (rebinding) is refused at connect time.
- **API (Hono, in memory, no port):** licence answers for valid, unknown, revoked and expired keys; scan auth; per-key hour and day limits; per-IP limits; the busy queue; the monthly cap; body size; private URL refusals; nothing logged that contains the full key.
- **Firestore store:** the same contract tests as the memory store, run against the Firestore emulator when `FIRESTORE_EMULATOR_HOST` is set, and skipped otherwise. The milestone report will say whether they ran.
- **Licence client:** env beats file; 24-hour cache; recheck after 24 hours; 7-day grace on network errors and 5xx but not on "invalid"; revoked clears the cache; `licenceKey` in project config is refused; the request body is exactly `{ key, version }`.
- **CLI and MCP, keyed and keyless:** keyless `scan` and `scan-url` exit 2 and `init` still works; the keyless MCP server lists tools and every call returns the licence error; keyed runs as today. Existing tests run keyed through a setup file that writes a fresh cache to a temporary `LEGAL_LINT_HOME`.
- **End to end:** the real API app in process (memory store, test egress policy, offline crawl) scans a runtime fixture, and the CLI's remote findings equal its local findings for the same fixture.
- **Privacy:** with a fresh cache, a repo scan makes no outbound call. With a stale cache, it makes exactly one, to the API, whose body is `{ key, version }` and contains no file path or content.

## Documentation

- README: keys (`activate`, `LEGAL_LINT_KEY`), what leaves the machine (key and version once a day; the URL for remote scans), `--local`.
- `packages/api/DEPLOY.md`: budget alert first, project setup, Firestore, service account, deploy, issue the first key, check image size, find the client-IP header layout, and what can still cost money.
- DECISIONS.md: one line per non-obvious choice above. LEGAL_REVIEW.md: new items (below).

## For the lawyer (LEGAL_REVIEW.md)

- The hosted service loads third-party sites on a user's request. Does this need terms of use, or a rule that users only scan sites they own or may test?
- The privacy wording in the README about what the API receives and logs.

## Out of scope

Billing, signup, a dashboard, batch scans (milestone 3), robots.txt, a revocation list beyond the API's own check, and multiple instances.

## Risks

- A budget alert only sends email; it does not stop billing. The real limits are max 1 instance and the monthly cap.
- Small charges remain possible if the image is over 0.5 GB, or build minutes or egress exceed their free allowance. The deploy guide checks each one.
- The client-IP header layout on Cloud Run is verified after the first deploy; until then the per-IP limits may key on the wrong address. Per-key limits and the monthly cap do not depend on it.
