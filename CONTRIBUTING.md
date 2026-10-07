# Contributing

How to work on Legal Lint without breaking its promises. Read `README.md` for what the tool does and `CLAUDE.md` for how the code fits together.

## Which document is for what

| File | What it holds | Update it when |
|---|---|---|
| `RULEBOOK.md` | The product spec: every rule's trap, law, detection, exposure | The lawyer or owner changes a rule. Change the rule's `legal.yaml` in the same commit. |
| `DECISIONS.md` | One line per non-obvious choice, and why | You choose something a reader could not guess from the code |
| `LEGAL_REVIEW.md` | Questions for the lawyer, and legal-facing text we wrote ourselves | You write user-facing legal wording, or a rulebook figure looks wrong |
| `KNOWN_ISSUES.md` | Open bugs, limits and deferred work | You find a problem you are not fixing now, or you fix one listed there |
| `CHANGELOG.md` | What changed in each release | Every user-visible change, under "Unreleased" |
| `RELEASING.md` | How to publish the CLI and redeploy the API | The release steps change |
| `docs/adding-a-rule.md` | The recipe for a new rule | The rule interface or the fixture harness changes |
| `packages/api/DEPLOY.md` | First deploy of the hosted API, and its limits | Deploy steps or environment variables change |
| `packages/api/OPERATIONS.md` | Running the hosted API: keys, errors, logs, usage | A new error reason, log field or admin command |
| `CLAUDE_CODE_PROMPT.md` | The original phase 1 brief | Never. It is history; `DECISIONS.md` records where we departed from it. |

## Before every commit

```sh
pnpm typecheck
pnpm build      # tests/mcp-stdio.test.ts runs the built CLI, so build first
pnpm test
```

All three must pass. The Firestore contract test is skipped unless `FIRESTORE_EMULATOR_HOST` is set (see `packages/api/DEPLOY.md` section 9). Run it whenever you touch `packages/api/src/store*.ts` or `firestore-store.ts`.

## Commits

- Small, one change each, with a conventional message: `feat(rules): …`, `fix(LL-02): …`, `test: …`, `docs: …`, `chore: …`. Scopes in use: `core`, `rules`, `cli`, `mcp`, `api`, `report`, and a rule id for a rule fix.
- The repo's git identity only. No co-author lines or generated-by footers.
- Commit locally. Pushing is the owner's call.

## Fixtures come first

A rule is only as good as the fixtures that prove it. `tests/fixture-meta.test.ts` enforces this for every rule and mode (static, runtime):

- at least two `fires-*` fixtures, each with a `.fixed` twin that scans clean;
- at least two quiet fixtures (`pass-*` or `near-miss-*`), at least one of them a near miss.

When changing a detector:

1. **Write the fixture before the fix.** A false alarm found on a real repo becomes a `near-miss-*` fixture. A missed case becomes a `fires-*` fixture with its `.fixed` twin.
2. **Mutation-check the detector.** Break the condition you just added (invert it, delete it) and confirm a fixture fails. If nothing fails, the fixture is not testing what you think.
3. **Never special-case a fixture.** If a fixture is hard to pass, the detector is not handling the general case. Write down why rather than matching the fixture's exact text.
4. **When unsure, lower the confidence or stay silent.** A false alarm costs more than a missed finding.

To try a detector on a real project, scan a **copy** of it, never the original:

```sh
cp -R ~/Documents/GitHub/some-app /tmp/some-app-copy
node packages/cli/dist/bin.js scan /tmp/some-app-copy --json
```

## Rules that tests enforce

You will find out when you break these, but it is quicker to know them:

- `legal.yaml` copies `RULEBOOK.md` word for word (`tests/rulebook-sync.test.ts`).
- A finding explanation is exactly two sentences and avoids words that conclude the user breaks the law (`tests/helpers/wording.ts`).
- A repo scan sends nothing but the licence check (`tests/privacy.test.ts`).
- Runtime tests never touch the network. Fixture sites are served from 127.0.0.1.
- The deploy script cannot loosen the free-tier limits, and the Docker image's package versions must match `package.json` (`packages/api/src/deploy-files.test.ts`).

## Rules no test can enforce

- Do not correct or extend legal figures, dates or citations from memory. Copy the rulebook and add doubts to `LEGAL_REVIEW.md`.
- No LLM API calls and no model API key anywhere in the project.
- Legal Lint never edits the user's code. New capability goes into fix guidance, not a fix command.
- Not in phase 1: billing, a web UI, a GitHub App, rules LL-06 to LL-15, batch URL scans. Don't build or stub them without the owner's go-ahead.
