# Known issues

This file gives the open bugs, the limits and the work for a later time. Thus no item is only in the memory of one person. Remove an entry in the commit that fixes it. `DECISIONS.md` explains the limits that we selected by design. This file lists them only so that they are easy to find.

Last check: 2026-10-07.

## Items that stop the first release

- **`DEFAULT_API_URL` is empty** (`packages/cli/src/licence/api.ts`). It waits for the first Cloud Run deploy. Until then, activation and public URL scans need `LEGAL_LINT_API_URL`.
- **The hosted API was never deployed. Its Docker image was never built.** `deploy-files.test.ts` tests `Dockerfile`, `cloudbuild.yaml` and `deploy.sh`, but nobody ran these files.
- **`TRUSTED_PROXY_HOPS` is not confirmed.** Until you do `DEPLOY.md` section 6, the limits for each IP address can count the incorrect address. This does not change the limits for each key or the monthly limit.
- **`packages/cli` has no README.** Thus the npm page will be empty. See `RELEASING.md`.

## Bugs

- **`admin issue --expires` accepts dates that cannot exist** (`packages/api/src/admin.ts:28-29`). The code only compares the input with the format `YYYY-MM-DD`:
  - The code keeps `2026-02-30` as 2026-03-02 and gives no error. But the message says "expires 2026-02-30".
  - `2026-13-45` causes a crash with `RangeError: Invalid time value`.

  Fix: refuse a date if its `toISOString().slice(0, 10)` is different from the input.
- **The `refused` list of the egress proxy becomes larger for the full life of the process** (`packages/api/src/egress/proxy.ts:32,40`). The code adds one `host:port` string for each refused connection and never removes it. The list becomes larger only for refused (private) targets. Cloud Run also restarts instances that are idle. Thus the effect is small.
- **The API does not log errors that it does not handle** (`packages/api/src/app.ts:71`). `app.onError` answers 500 `internal`, but it does not keep the error. Thus the Cloud Run logs do not show the cause. Fix: before the answer, log the message and the stack of the error. Never log the request body.

## Limits

- **The crawler ignores robots.txt.** We did not do milestone 3 (batch URL scans). Milestone 3 had the robots.txt support.
- **The scanner reads `.vue`, `.svelte` and `.astro` files as HTML text.** It does not parse their script blocks.
- **LL-03 finds only the five tools in the rulebook.** It does not find Sentry Replay or other tools.
- **Hosted scans cut each page** to 1,000,000 characters of HTML and 300,000 characters of text. The scan does not find a finding after the cut.
- **The API can remember that a key is over its limit. If you revoke this key during that time**, the API gives 429, not 401, until the time window ends.
- **The limits for each IP address and the memory of keys that are over the limit are in the process memory.** They are correct only with `--max-instances 1`.
- **The legal text is a draft.** Each `legal.yaml` has `sources: []`, `lastReviewed: null` and `reviewStatus: draft` until the lawyer does a review (`LEGAL_REVIEW.md`).

## Gaps in tests and reviews

- **The Firestore contract tests run only with the emulator** (`FIRESTORE_EMULATOR_HOST`). They passed with `firebase-tools@13` on Java 17. The current firebase-tools needs Java 21.
- **The final review of milestone 5 was partial.** The tests, docs and deploy files got only a review by the author.
