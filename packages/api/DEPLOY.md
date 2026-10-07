# Deploying the Legal Lint API

The API runs on Google Cloud Run in `us-central1` with Firestore as its key store. Everything here is set up to stay inside Google Cloud's free quota: one instance at most, scale to zero, CPU only while a request is being handled, and a hard cap on hosted scans per month.

Run every command from the repository root unless a step says otherwise. Replace `<id>` with your project id.

## 1. Before anything: a $1 budget alert

Console → Billing → Budgets & alerts → Create budget.

- Amount: **$1**.
- Alert thresholds: **50%, 90% and 100%**.

The alert only sends email. It does not stop billing. The real limits are `--max-instances 1` in `deploy.sh` and `SCANS_PER_MONTH` (section 8).

## 2. One-time setup

1. Install the gcloud CLI: https://cloud.google.com/sdk/docs/install
2. Log in, create the project and link billing:

   ```bash
   gcloud auth login
   gcloud projects create <id>
   gcloud billing accounts list
   gcloud billing projects link <id> --billing-account <ACCOUNT_ID>
   gcloud config set project <id>
   ```

3. Turn on the services the API uses:

   ```bash
   gcloud services enable run.googleapis.com firestore.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
   ```

4. Create the Firestore database. Use the default database: the free quota applies only to it.

   ```bash
   gcloud firestore databases create --location=us-central1
   ```

5. Create the image repository and keep only the latest image, so stored images stay under the 0.5 GB free allowance:

   ```bash
   gcloud artifacts repositories create legal-lint --repository-format=docker --location=us-central1
   gcloud artifacts repositories set-cleanup-policies legal-lint --location=us-central1 --policy=packages/api/cleanup-policy.json --no-dry-run
   ```

6. Create the service account the API runs as. It gets Firestore access and nothing else:

   ```bash
   gcloud iam service-accounts create legal-lint-api
   gcloud projects add-iam-policy-binding <id> \
     --member=serviceAccount:legal-lint-api@<id>.iam.gserviceaccount.com \
     --role=roles/datastore.user
   ```

## 3. Deploy

```bash
PROJECT=<id> ./packages/api/deploy.sh
```

The script builds the image with Cloud Build and deploys it with the free-tier limits. At the end gcloud prints the service URL (`https://legal-lint-api-….run.app`). Check it:

```bash
curl <url>/healthz
```

Expected: `{"ok":true}`.

## 4. Issue your first key

The admin script runs on your laptop and talks to Firestore with your own Google login.

```bash
gcloud auth application-default login
pnpm --filter @legal-lint/api build
GOOGLE_CLOUD_PROJECT=<id> node packages/api/dist/admin.js issue --label you@example.com
```

The key is printed once. Firestore keeps only its SHA-256 hash and its first 8 characters, so a lost key cannot be recovered: issue a new one.

Other commands:

```bash
GOOGLE_CLOUD_PROJECT=<id> node packages/api/dist/admin.js issue --label founder@example.com --expires 2027-01-01
GOOGLE_CLOUD_PROJECT=<id> node packages/api/dist/admin.js list
GOOGLE_CLOUD_PROJECT=<id> node packages/api/dist/admin.js revoke ll_AbC12
```

A key with `--expires 2027-01-01` stops working at 2027-01-01 00:00 UTC.

## 5. Point the CLI at it

```bash
LEGAL_LINT_API_URL=<url> legal-lint activate <key>
LEGAL_LINT_API_URL=<url> legal-lint licence
```

Then send the URL to the developer, so it becomes `DEFAULT_API_URL` in `packages/cli/src/licence/api.ts` and users no longer need `LEGAL_LINT_API_URL`.

## 6. Find the client-IP header layout (once)

The per-IP limits read `X-Forwarded-For`. Clients can add entries to the left of that header, so the API counts `TRUSTED_PROXY_HOPS` entries from the right. Check which entry is really yours:

1. Log the header for a while:

   ```bash
   gcloud run services update legal-lint-api --region us-central1 --update-env-vars LOG_FORWARDED_FOR=1
   ```

2. Call the licence endpoint from your laptop:

   ```bash
   curl -s -X POST <url>/v1/licence -H 'content-type: application/json' -d '{"key":"ll_test","version":"0"}'
   ```

3. In the Cloud Run logs, find the `"forwardedFor"` line and compare it with your address from `curl -s https://ifconfig.me`.
4. If your address is the last entry, keep `TRUSTED_PROXY_HOPS=1` (the default). If it is second from the right, set `TRUSTED_PROXY_HOPS=2`, and so on:

   ```bash
   gcloud run services update legal-lint-api --region us-central1 --update-env-vars TRUSTED_PROXY_HOPS=2
   ```

5. Turn the logging off again, because it records IP addresses:

   ```bash
   gcloud run services update legal-lint-api --region us-central1 --remove-env-vars LOG_FORWARDED_FOR
   ```

Until this is done, the per-IP limits may count the wrong address. The per-key limits and the monthly cap do not depend on it.

## 7. Check what can still cost money

- **Image size.** Free up to 0.5 GB stored, then about $0.10 per GB per month:

  ```bash
  gcloud artifacts docker images list us-central1-docker.pkg.dev/<id>/legal-lint --include-tags
  ```

- **Cloud Build minutes and outbound traffic.** Compare them with their free allowances on the billing page (Billing → Reports, grouped by SKU).
- **Hosted scans this month.** The `usage/month_<yyyy-mm>` document in the Firestore console holds the count.

## 8. Changing limits

Every limit is an environment variable. Change one with:

```bash
gcloud run services update legal-lint-api --region us-central1 --update-env-vars SCANS_PER_MONTH=1000
```

| Variable | Default | Meaning |
|---|---|---|
| `SCANS_PER_MONTH` | 1500 | Hosted scans per calendar month (UTC) for the whole service. |
| `SCANS_PER_KEY_HOUR` | 10 | Hosted scans per key per UTC hour. |
| `SCANS_PER_KEY_DAY` | 50 | Hosted scans per key per UTC day. |
| `LICENCE_CHECKS_PER_IP_HOUR` | 30 | Licence checks per client address per hour. |
| `FAILED_AUTH_PER_IP_HOUR` | 10 | Wrong or missing keys per client address per hour before it is refused. |
| `MAX_RUNNING_SCANS` | 2 | Scans running at once. |
| `MAX_WAITING_SCANS` | 4 | Scans waiting for a slot; more are refused with 503. |
| `TRUSTED_PROXY_HOPS` | 1 | `X-Forwarded-For` entries added by Google's proxies (section 6). |
| `PAGE_TIMEOUT_MS` | 15000 | Load timeout per page. |
| `SCAN_BUDGET_MS` | 40000 | No new page is started after this long. |
| `LOG_FORWARDED_FOR` | unset | `1` logs the raw `X-Forwarded-For` header. Only for section 6. |

## 9. Testing the Firestore store

The store's contract tests run against the Firestore emulator, never a real project. The emulator needs Java: the current firebase-tools needs Java 21 or newer. With Java 17, use `firebase-tools@13` instead of `@latest` (that is how the tests were run in milestone 5).

```bash
npx -y firebase-tools@latest emulators:start --only firestore --project legal-lint-test
# in another terminal:
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm vitest run packages/api/src/firestore-store.test.ts
```

Without `FIRESTORE_EMULATOR_HOST` the test is skipped.
