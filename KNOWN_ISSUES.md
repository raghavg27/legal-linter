# Known issues

Open bugs, limits and deferred work, so nothing lives only in someone's memory. Remove an entry in the commit that fixes it. Limits that are deliberate design choices are explained in `DECISIONS.md`; they are listed here only so they are easy to find.

Last checked: 2026-10-07.

## Blocking the first release

- **`DEFAULT_API_URL` is empty** (`packages/cli/src/licence/api.ts`). It waits for the first Cloud Run deploy. Until then, activation and public URL scans need `LEGAL_LINT_API_URL`.
- **The hosted API has never been deployed, and its Docker image has never been built.** `Dockerfile`, `cloudbuild.yaml` and `deploy.sh` are covered by `deploy-files.test.ts` but have not been run.
- **`TRUSTED_PROXY_HOPS` is unconfirmed.** Until `DEPLOY.md` section 6 is done, the per-IP limits may count the wrong address. Per-key limits and the monthly cap are unaffected.
- **`packages/cli` has no README**, so the npm page would be blank. See `RELEASING.md`.

## Bugs

- **`admin issue --expires` accepts impossible dates** (`packages/api/src/admin.ts:28-29`). The input is only checked against `YYYY-MM-DD`:
  - `2026-02-30` is silently stored as 2026-03-02, while the message says "expires 2026-02-30".
  - `2026-13-45` crashes with `RangeError: Invalid time value`.

  Fix: reject a date whose `toISOString().slice(0, 10)` differs from the input.
- **The egress proxy's `refused` list grows for the life of the process** (`packages/api/src/egress/proxy.ts:32,40`). One `host:port` string is added for every refused connection and never removed. It only grows with refused (private) targets, and Cloud Run restarts idle instances, so the impact is small.
- **Unhandled API errors are not logged** (`packages/api/src/app.ts:71`). `app.onError` answers 500 `internal` but drops the error, so Cloud Run logs show no cause. Fix: log the error's message and stack (never the request body) before answering.

## Limits

- **The crawler ignores robots.txt.** Milestone 3 (batch URL scans, which brought robots.txt) was skipped.
- **`.vue`, `.svelte` and `.astro` files are scanned as HTML text.** Their script blocks are not parsed.
- **LL-03 covers only the rulebook's five tools.** Sentry Replay and others are not detected.
- **Hosted scans cut each page** to 1,000,000 characters of HTML and 300,000 of text. A finding beyond the cut is missed.
- **A key revoked while it is remembered as over its limit** gets 429 instead of 401 until the window ends.
- **Per-IP limits and the over-limit memory live in process memory.** They are correct only with `--max-instances 1`.
- **Legal text is draft.** Every `legal.yaml` has `sources: []`, `lastReviewed: null` and `reviewStatus: draft` until the lawyer reviews it (`LEGAL_REVIEW.md`).

## Test and review gaps

- **The Firestore contract tests run only under the emulator** (`FIRESTORE_EMULATOR_HOST`). They passed with `firebase-tools@13` on Java 17. The current firebase-tools needs Java 21.
- **The milestone 5 final review was partial.** Tests, docs and deploy files got only a self-review.
