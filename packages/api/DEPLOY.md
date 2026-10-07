# Deploying the Legal Lint API

The API runs on Google Cloud Run in `us-central1`. It keeps the keys in Firestore. All the settings in this document keep the API in the free quota of Google Cloud:

- A maximum of one instance.
- Scale to zero.
- The API uses the CPU only while it handles a request.
- A hard limit on the number of hosted scans each month.

Run all commands from the root of the repository, if a step does not tell you differently. Replace `<id>` with the id of your project.

## 1. First: a $1 budget alert

Console → Billing → Budgets & alerts → Create budget.

- Amount: **$1**.
- Alert thresholds: **50%, 90% and 100%**.

The alert only sends email. It does not stop the billing. The real limits are `--max-instances 1` in `deploy.sh` and `SCANS_PER_MONTH` (section 8).

## 2. Setup (one time)

1. Install the gcloud CLI: https://cloud.google.com/sdk/docs/install
2. Log in, create the project and connect the billing account:

   ```bash
   gcloud auth login
   gcloud projects create <id>
   gcloud billing accounts list
   gcloud billing projects link <id> --billing-account <ACCOUNT_ID>
   gcloud config set project <id>
   ```

3. Turn on the services that the API uses:

   ```bash
   gcloud services enable run.googleapis.com firestore.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
   ```

4. Create the Firestore database. Use the default database, because the free quota applies only to the default database.

   ```bash
   gcloud firestore databases create --location=us-central1
   ```

5. Create the image repository. Keep only the latest image. Thus the stored images stay below the free allowance of 0.5 GB:

   ```bash
   gcloud artifacts repositories create legal-lint --repository-format=docker --location=us-central1
   gcloud artifacts repositories set-cleanup-policies legal-lint --location=us-central1 --policy=packages/api/cleanup-policy.json --no-dry-run
   ```

6. Create the service account for the API. It gets access to Firestore and to nothing else:

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

The script builds the image with Cloud Build. Then it deploys the image with the free-tier limits. At the end, gcloud shows the URL of the service (`https://legal-lint-api-….run.app`). Do a check of the URL:

```bash
curl <url>/healthz
```

The result must be `{"ok":true}`.

## 4. Issue your first key

The admin script runs on your laptop. It connects to Firestore with your own Google login.

```bash
gcloud auth application-default login
pnpm --filter @legal-lint/api build
GOOGLE_CLOUD_PROJECT=<id> node packages/api/dist/admin.js issue --label you@example.com
```

The script shows the key one time only. Firestore keeps only the SHA-256 hash and the first 8 characters of the key. Thus you cannot get back a lost key. If you lose a key, issue a new key.

Other commands:

```bash
GOOGLE_CLOUD_PROJECT=<id> node packages/api/dist/admin.js issue --label founder@example.com --expires 2027-01-01
GOOGLE_CLOUD_PROJECT=<id> node packages/api/dist/admin.js list
GOOGLE_CLOUD_PROJECT=<id> node packages/api/dist/admin.js revoke ll_AbC12
```

A key with `--expires 2027-01-01` stops at 2027-01-01 00:00 UTC.

## 5. Connect the CLI to the API

```bash
LEGAL_LINT_API_URL=<url> legal-lint activate <key>
LEGAL_LINT_API_URL=<url> legal-lint licence
```

Then send the URL to the developer. The developer puts it in `DEFAULT_API_URL` in `packages/cli/src/licence/api.ts`. After that, users do not need `LEGAL_LINT_API_URL`.

## 6. Find the layout of the client IP header (one time)

The limits for each IP address read `X-Forwarded-For`. Clients can add entries to the left side of that header. Thus the API counts `TRUSTED_PROXY_HOPS` entries from the right side. Find the entry that is really your address:

1. Log the header for some time:

   ```bash
   gcloud run services update legal-lint-api --region us-central1 --update-env-vars LOG_FORWARDED_FOR=1
   ```

2. Call the licence endpoint from your laptop:

   ```bash
   curl -s -X POST <url>/v1/licence -H 'content-type: application/json' -d '{"key":"ll_test","version":"0"}'
   ```

3. In the Cloud Run logs, find the `"forwardedFor"` line. Compare it with your address from `curl -s https://ifconfig.me`.
4. If your address is the last entry, keep `TRUSTED_PROXY_HOPS=1` (the default). If it is the second entry from the right, set `TRUSTED_PROXY_HOPS=2`. Continue in the same pattern for other positions:

   ```bash
   gcloud run services update legal-lint-api --region us-central1 --update-env-vars TRUSTED_PROXY_HOPS=2
   ```

5. Turn off the logging again, because it records IP addresses:

   ```bash
   gcloud run services update legal-lint-api --region us-central1 --remove-env-vars LOG_FORWARDED_FOR
   ```

Until you do this section, the limits for each IP address can count the incorrect address. The limits for each key and the monthly limit do not use this header.

## 7. Examine the items that can still cost money

- **Image size.** Storage is free up to 0.5 GB. After that, it costs approximately $0.10 for each GB each month:

  ```bash
  gcloud artifacts docker images list us-central1-docker.pkg.dev/<id>/legal-lint --include-tags
  ```

- **Cloud Build minutes and outbound traffic.** Compare them with their free allowances on the billing page (Billing → Reports, grouped by SKU).
- **Hosted scans in this month.** The `usage/month_<yyyy-mm>` document in the Firestore console has the count.

## 8. Change the limits

Each limit is an environment variable. To change a limit, use this command:

```bash
gcloud run services update legal-lint-api --region us-central1 --update-env-vars SCANS_PER_MONTH=1000
```

| Variable | Default | Meaning |
|---|---|---|
| `SCANS_PER_MONTH` | 1500 | Hosted scans for each calendar month (UTC), for the full service. |
| `SCANS_PER_KEY_HOUR` | 10 | Hosted scans for each key for each UTC hour. |
| `SCANS_PER_KEY_DAY` | 50 | Hosted scans for each key for each UTC day. |
| `LICENCE_CHECKS_PER_IP_HOUR` | 30 | Licence checks for each client address for each hour. |
| `FAILED_AUTH_PER_IP_HOUR` | 10 | Incorrect or missing keys for each client address for each hour. After this number, the API refuses the address. |
| `MAX_RUNNING_SCANS` | 2 | Scans that run at the same time. |
| `MAX_WAITING_SCANS` | 4 | Scans that wait for a position. The API refuses more scans with 503. |
| `TRUSTED_PROXY_HOPS` | 1 | `X-Forwarded-For` entries that the Google proxies add (section 6). |
| `PAGE_TIMEOUT_MS` | 15000 | Load timeout for each page. |
| `SCAN_BUDGET_MS` | 40000 | After this time, the scan does not start a new page. |
| `MAX_PAGE_HTML_CHARS` | 1000000 | HTML that a scan result keeps for each page. The API cuts longer pages. |
| `MAX_PAGE_TEXT_CHARS` | 300000 | Visible text that a scan result keeps for each page. |
| `SCAN_DEADLINE_MS` | 60000 | Hard limit for one scan. If a page freezes, the API closes it and reports the scan as failed. |
| `LOG_FORWARDED_FOR` | not set | `1` logs the raw `X-Forwarded-For` header. Use it only for section 6. |

## 9. Test the Firestore store

The contract tests of the store run on the Firestore emulator. They never use a real project. The emulator needs Java. The current firebase-tools needs Java 21 or newer. With Java 17, use `firebase-tools@13`, not `@latest`. In milestone 5, the tests ran with `firebase-tools@13`.

```bash
npx -y firebase-tools@latest emulators:start --only firestore --project legal-lint-test
# in a different terminal:
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm vitest run packages/api/src/firestore-store.test.ts
```

If `FIRESTORE_EMULATOR_HOST` is not set, the test does not run.
