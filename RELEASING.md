# Releasing

Two items ship separately:

- The `legal-lint` npm package (`packages/cli`). Core and rules are bundled in it.
- The hosted API (`packages/api`), on Cloud Run.

Nothing is released at this time. Thus the first use of this checklist is also its test. If the real procedure is different, correct this file.

## Only before the first release

- [ ] The API is deployed (`packages/api/DEPLOY.md`). `DEFAULT_API_URL` in `packages/cli/src/licence/api.ts` has the URL of the API. Until you set it, each user must set `LEGAL_LINT_API_URL`.
- [ ] `TRUSTED_PROXY_HOPS` is confirmed (`DEPLOY.md` section 6).
- [ ] The npm name `legal-lint` is still available. On 2026-10-07, `npm view legal-lint` returned 404. `npm whoami` shows that you are logged in.
- [ ] `packages/cli` has a `README.md`. npm shows the README of the package folder. There is no README at this time, thus the npm page will be empty. Decide one of these two options: copy the root README into the folder at release time, or write a shorter README.
- [ ] The open items in `LEGAL_REVIEW.md` have answers, or the owner agrees to ship with draft legal text.

## API compatibility

Released CLIs communicate with the API through the wire format in `packages/core/src/remote.ts` (`scanRequestSchema`, `scanResponseSchema`, `siteCaptureSchema`, `licenceResponseSchema`). Old CLIs continue to operate after an API deploy. Thus:

- In responses, only add optional fields. Never remove a field that a released CLI reads, and never change its name.
- If a change needs the two sides, deploy the API first. Then publish the CLI.
- A change to rules only (a new detector, a new fixture) does not need an API deploy. The API returns the raw capture, and the CLI runs the rules.

## Publish the CLI

1. In `CHANGELOG.md`, move the "Unreleased" entries under a new version heading with the date of today.
2. Increase `version` in `packages/cli/package.json`. The CLI reads its version from this file. The user agent of the crawler also uses it.
3. Do the checks:

   ```sh
   pnpm install --frozen-lockfile
   pnpm typecheck
   pnpm build
   pnpm test
   ```

4. Examine the contents of the package:

   ```sh
   cd packages/cli && pnpm pack && tar -tzf legal-lint-*.tgz
   ```

   The package must contain `package/package.json`, `package/dist/bin.js` (and chunks, if there are chunks) and a README. It must not contain `src/`, fixtures or tests.

5. Do a smoke test of the tarball in an empty folder with a real key:

   ```sh
   mkdir /tmp/ll-smoke && cd /tmp/ll-smoke && npm init -y >/dev/null
   npm install /path/to/legal-linter/packages/cli/legal-lint-<version>.tgz
   npx legal-lint --version
   npx legal-lint activate <key>
   npx legal-lint scan /path/to/legal-linter/fixtures/LL-01/fires-html-font-face   # expect exit 1 and two LL-01 findings
   npx legal-lint scan-url https://example.com                                    # uses the hosted scanner
   ```

6. Publish from `packages/cli` with pnpm. pnpm changes the `workspace:*` versions to real versions:

   ```sh
   pnpm publish --access public
   ```

7. Commit the version change and the changelog. Then add a tag: `git tag v<version>`.

## Deploy the API

```sh
PROJECT=<id> ./packages/api/deploy.sh
curl <url>/healthz   # {"ok":true}
```

`deploy.sh` keeps the free-tier limits. `packages/api/src/deploy-files.test.ts` fails if a person makes the limits larger. After a deploy, run one `legal-lint scan-url` on a public site. Then find the request in the Cloud Run logs (`packages/api/OPERATIONS.md`).
