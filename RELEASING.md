# Releasing

Two things ship separately: the `legal-lint` npm package (`packages/cli`, with core and rules bundled in) and the hosted API (`packages/api`, on Cloud Run). Nothing has been released yet, so the first run of this checklist is also its test. Fix this file wherever reality differs.

## Before the first release only

- [ ] The API is deployed (`packages/api/DEPLOY.md`), and `DEFAULT_API_URL` in `packages/cli/src/licence/api.ts` is set to its URL. Until it is set, every user needs `LEGAL_LINT_API_URL`.
- [ ] `TRUSTED_PROXY_HOPS` is confirmed (`DEPLOY.md` section 6).
- [ ] The npm name `legal-lint` is still free (`npm view legal-lint` returned 404 on 2026-10-07), and you are logged in with `npm whoami`.
- [ ] `packages/cli` has a `README.md`. npm shows the package folder's README, and there is none yet, so the npm page would be blank. Decide whether to copy the root README in at release time or write a shorter one.
- [ ] The open items in `LEGAL_REVIEW.md` are answered, or the owner accepts shipping with draft legal text.

## API compatibility

Released CLIs talk to the API through the wire format in `packages/core/src/remote.ts` (`scanRequestSchema`, `scanResponseSchema`, `siteCaptureSchema`, `licenceResponseSchema`). Older CLIs keep running after an API deploy, so:

- Only add optional fields to responses. Never remove or rename one that a released CLI reads.
- When a change needs both sides, deploy the API first, then publish the CLI.
- A rule-only change (new detector, new fixture) does not need an API deploy: the API returns the raw capture and the CLI runs the rules.

## Publishing the CLI

1. Move "Unreleased" entries in `CHANGELOG.md` under a new version heading with today's date.
2. Bump `version` in `packages/cli/package.json`. The CLI reads its version from there, and so does the crawler's user agent.
3. Check:

   ```sh
   pnpm install --frozen-lockfile
   pnpm typecheck
   pnpm build
   pnpm test
   ```

4. Look inside the package:

   ```sh
   cd packages/cli && pnpm pack && tar -tzf legal-lint-*.tgz
   ```

   Expect `package/package.json`, `package/dist/bin.js` (plus any chunks) and a README. No `src/`, fixtures or tests.

5. Smoke-test the tarball in an empty folder with a real key:

   ```sh
   mkdir /tmp/ll-smoke && cd /tmp/ll-smoke && npm init -y >/dev/null
   npm install /path/to/legal-linter/packages/cli/legal-lint-<version>.tgz
   npx legal-lint --version
   npx legal-lint activate <key>
   npx legal-lint scan /path/to/legal-linter/fixtures/LL-01/fires-html-font-face   # expect exit 1 and two LL-01 findings
   npx legal-lint scan-url https://example.com                                    # exercises the hosted scanner
   ```

6. Publish from `packages/cli` with pnpm, which rewrites the `workspace:*` versions:

   ```sh
   pnpm publish --access public
   ```

7. Commit the version bump and changelog, then tag: `git tag v<version>`.

## Deploying the API

```sh
PROJECT=<id> ./packages/api/deploy.sh
curl <url>/healthz   # {"ok":true}
```

`deploy.sh` keeps the free-tier limits, and `packages/api/src/deploy-files.test.ts` fails if they are loosened. After a deploy, run one `legal-lint scan-url` against a public site and check the request in the Cloud Run logs (`packages/api/OPERATIONS.md`).
