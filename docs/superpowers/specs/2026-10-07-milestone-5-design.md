# Milestone 5: hosted API and licence keys

Status: approved in chat on 2026-10-07 (decisions 1 to 11 below). This specification records the decisions for review.

## Goal

1. A small hosted service with two functions: validate licence keys, and load public URLs in Chromium for users who did not install Chromium.
2. A licence gate in the CLI and in the MCP server. There is no free tier. If there is no valid key, scans and MCP tools refuse to run (owner decision, 2026-10-06).

The hosting must stay in the free quota of Google Cloud. The owner has no budget. Thus the cost limits are a part of the design from the start, not an item for later.

## Items that do not change

- Repository scans run locally. Source code, file paths, intake answers and judgments never go out of the machine.
- The only data that goes to the API is the licence key, the package version and, for URL scans, the URL.
- The rules are in the local package. No obfuscation and no anti-tamper code.

## Decisions

1. **The server records, and the client makes the decisions.** `POST /v1/scan` returns a `SiteCapture` (requests, cookies, page text and HTML, links). The CLI runs the runtime rules on it with `evaluateCapture`, with the local intake and judgments. If the rules ran on the server, the client would have to send the intake answers.
2. **Public URLs go to the API. Local URLs stay local.** The tool scans these with local Chromium: `localhost`, `*.localhost`, and IP literals in private, loopback or link-local ranges. `--local` (CLI) and `local: true` (MCP `scan_url`) make the scan local. If the API refuses a URL as private (for example, an internal hostname), the error tells the user to use `--local`.
3. **The key is never in the project config.** `legal-lint.config.json` is committed. The key comes from `LEGAL_LINT_KEY`. If that is not set, it comes from `~/.legal-lint/key`, which `legal-lint activate <key>` writes (file mode 0600). If a config still has `licenceKey`, the tool refuses it. The message tells where to move the key.
4. **Cache and grace.** The tool keeps a valid answer for 24 hours in `~/.legal-lint/licence.json`. The key of the cache is a hash of the licence key. Thus a scan usually makes no network call. After 24 hours, the client checks again. If the client cannot connect to the API (network error, timeout or 5xx), the tool continues to operate with a warning. This continues for a maximum of 7 days after the last good check. A clear "invalid", "revoked" or "expired" answer deletes the cache and stops the tool immediately.
5. **The commands that run without a key:** `--help`, `--version`, `init`, `activate` and `licence`. `licence` shows the source of the key, the masked key, the last check, the date until which the key is valid, and the grace state. `scan` and `scan-url` give exit 2 with a message that tells how to set a key. The MCP server still starts and lists its tools. Each tool call returns an error with the same message. Thus the agent can tell the user what to do.
6. **Host: Google Cloud Run in us-central1.** Request-based billing, a maximum of 1 instance, a minimum of 0, 1 vCPU, 2 GiB, a request timeout of 120 s. The service permits unauthenticated requests, because our key is the authentication. The image is Node slim and only the Chromium headless shell of Playwright. The objective is to stay below the free storage of 0.5 GB of Artifact Registry. Old images are deleted. The service runs as its own service account, with access only to Firestore. The owner does the deployment with a script and a written guide. The guide starts with a $1 budget alert.
7. **Keys:** `ll_` and then 32 random base62 characters (approximately 190 bits). Firestore uses the SHA-256 of the key as the document id. It never keeps the key. Each key document has:
   - the first 8 characters of the key (for display and for `revoke`),
   - a label (the person who gets the key),
   - the date of creation,
   - the date of expiry (optional),
   - the date of revocation (optional).

   The owner runs an admin script on their laptop with `gcloud auth application-default login`. The script can do `issue --label <text> [--expires YYYY-MM-DD]`, `list` and `revoke <prefix>`. `issue` shows the key one time only.
8. **Cost limits:**
   - A hard limit of 1,500 scans for each calendar month (UTC) for the full service. A scan has a maximum of 60 seconds. In the worst case, 1,500 scans use 90,000 vCPU-seconds and 180,000 GiB-seconds. This is half of the free quota (180,000 and 360,000).
   - For each key: 10 scans each hour and 50 scans each day (fixed UTC windows).
   - For each IP address, in memory (this is safe with one instance): 30 licence checks each hour and 10 failed authentications each hour. The API refuses a scan without a valid key with 401 before Chromium starts.
   - A maximum of 2 scans run at the same time. A maximum of 4 scans wait. After that, the API answers 503 with `Retry-After`.
   - A scan counts against the limits when Chromium starts, also if the page does not load, because the compute is used in the two cases.
   - When the service has used all of the monthly limit, the API answers 503 with `reason: "monthly_budget"`. The CLI then recommends `--local`.
   - All limits are environment variables.
9. **SSRF protection, three layers:**
   - *Input:* only http or https, no username or password in the URL, only ports 80 and 443. Each address that the hostname resolves to must be public unicast.
   - *Egress proxy:* the API starts Chromium with a proxy that runs in the API process. Each connection that Chromium makes goes through the proxy. This includes redirects, subresources, iframes and websockets. The proxy resolves the hostname itself. It refuses the connection if an address is not public unicast. It connects to the address that it checked. Thus DNS rebinding cannot change the address. The refused ranges are: loopback, private, link-local (the metadata server of Cloud Run at 169.254.169.254), unique-local and Google-internal IPv6, carrier-grade NAT, multicast, reserved and unspecified. IPv4 addresses in IPv6 (mapped, 6to4, Teredo) are also refused.
   - *Chromium flags:* `--proxy-bypass-list=<-loopback>` removes the built-in exception of Chromium that sends localhost around the proxy. WebRTC can use only traffic through the proxy. QUIC is disabled. Thus no traffic goes out outside the proxy.
10. **API URL:** the client reads `LEGAL_LINT_API_URL`. The default goes into the code after the first deploy, when Cloud Run gives the URL. Until then, a missing URL gives a clear error.
11. **Tests:** see Testing.

## Architecture

```
packages/
  core/   + src/remote.ts         wire format: zod schemas for the requests and responses of the API, with SiteCapture
  cli/    + src/licence/          key lookup, cache, grace, API client, the gate
          + src/remote-scan.ts    POST /v1/scan, validate the capture, then evaluateCapture locally
          ~ program.ts            gate on scan and scan-url; new activate and licence commands; --local
          ~ mcp/server.ts         gate on each tool; scan_url gets `local`
  api/    (new, private, not published to npm)
          src/app.ts              Hono app: routes, auth, limits; dependencies are injected
          src/store.ts            KeyStore + UsageStore interfaces; memory and Firestore implementations
          src/limits.ts           limiter for each IP address, scan queue
          src/egress/policy.ts    decides if an address is permitted (ipaddr.js)
          src/egress/proxy.ts     HTTP and CONNECT proxy that resolves, checks and connects
          src/scan.ts             starts Chromium with the proxy and flags, captureSite with a budget of 60 s
          src/server.ts           entry point for Cloud Run (PORT)
          src/admin.ts            issue, list, revoke
          Dockerfile, deploy.sh, DEPLOY.md
```

Core gets no licence logic. The API package uses `captureSite` from core with an injected browser.

## API

| Method and path | Auth | Body | Answer |
|---|---|---|---|
| `POST /v1/licence` | none (limit for each IP) | `{ key, version }` | 200 `{ valid: true, expiresAt }` or 200 `{ valid: false, reason: "unknown" \| "revoked" \| "expired" }` |
| `POST /v1/scan` | `Authorization: Bearer <key>` | `{ url, version }` | 200 `{ capture }`; 400 incorrect or private URL; 401 incorrect key; 429 key limit (`Retry-After`); 503 busy or `monthly_budget` |
| `GET /healthz` | none | | 200 |

Errors are `{ error: { reason, message } }`. The API refuses bodies that are larger than 4 KB. The API logs only the key prefix, the URL host, the outcome and the duration.

## Client flow

1. A gated command starts. The client finds the key (first the environment, then the file). If there is no key, exit 2 with instructions.
2. If the cache for this key was checked less than 24 hours ago and is valid, continue.
3. If not, `POST /v1/licence`. If the key is valid, write the cache and continue. If the key is not valid, delete the cache. Then exit 2 with the reason.
4. If the client cannot connect to the API: if the last good check was less than 7 days ago, continue with a warning on stderr. If not, exit 2.
5. `scan-url`: local or remote, as decision 2 tells. For a remote scan: `POST /v1/scan`, validate the capture with zod, run `evaluateCapture` with the local intake and judgments. Then give the usual output and the HTML report.

## Testing

- **Egress policy:** a table of addresses with the expected answer. The table has IPv4 and IPv6, each refused range, IPv4 in IPv6, and public examples.
- **Proxy, with real sockets:** a "permitted" fixture server and an "internal" server on 127.0.0.1, with a test policy that permits only the fixture port. Through Chromium and the proxy, the proxy refuses a redirect, an image, an iframe and a websocket that point to the internal server. The internal server gets zero connections. The proxy refuses, at connect time, a resolver that first answers with a public address and then with a private address (rebinding).
- **API (Hono, in memory, no port):** licence answers for valid, unknown, revoked and expired keys; scan auth; key limits for the hour and the day; limits for each IP address; the busy queue; the monthly limit; body size; refusals of private URLs; no log contains the full key.
- **Firestore store:** the same contract tests as the memory store. They run on the Firestore emulator when `FIRESTORE_EMULATOR_HOST` is set. If not, they do not run. The milestone report will tell if they ran.
- **Licence client:** the environment variable is more important than the file; the 24-hour cache; a new check after 24 hours; a 7-day grace on network errors and 5xx, but not on "invalid"; "revoked" clears the cache; the tool refuses `licenceKey` in the project config; the request body is exactly `{ key, version }`.
- **CLI and MCP, with and without a key:** without a key, `scan` and `scan-url` give exit 2, and `init` still operates. Without a key, the MCP server lists the tools and each call returns the licence error. With a key, all operates as before. The tests that exist run with a key through a setup file. The setup file writes a new cache to a temporary `LEGAL_LINT_HOME`.
- **End to end:** the real API app runs in the process (memory store, test egress policy, offline crawl). It scans a runtime fixture. The remote findings of the CLI must be the same as its local findings for the same fixture.
- **Privacy:** with a new cache, a repo scan makes no outbound call. With an old cache, it makes exactly one call, to the API. The body of this call is `{ key, version }` and contains no file path or content.

## Documentation

- README: keys (`activate`, `LEGAL_LINT_KEY`); the data that goes out of the machine (key and version one time each day; the URL for remote scans); `--local`.
- `packages/api/DEPLOY.md`: first the budget alert, then project setup, Firestore, service account, deploy, issue the first key, examine the image size, find the layout of the client IP header, and the items that can still cost money.
- DECISIONS.md: one line for each decision above that is not obvious. LEGAL_REVIEW.md: new items (below).

## For the lawyer (LEGAL_REVIEW.md)

- The hosted service loads sites of other persons when a user asks. Does this need terms of use, or a rule that users scan only sites that they own or have permission to test?
- The privacy text in the README about the data that the API receives and logs.

## Not in scope

Billing, signup, a dashboard, batch scans (milestone 3), robots.txt, a revocation list in addition to the check of the API, and more than one instance.

## Risks

- A budget alert only sends email. It does not stop the billing. The real limits are a maximum of 1 instance and the monthly limit.
- Small charges are still possible in these conditions: the image is larger than 0.5 GB, or the build minutes or the egress go above their free allowance. The deploy guide examines each of these items.
- We will verify the layout of the client IP header on Cloud Run after the first deploy. Until then, the limits for each IP address can use the incorrect address. The limits for each key and the monthly limit do not depend on it.
