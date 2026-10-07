# Adding a rule

This is the procedure to add a rule, for example a phase 2 rule (LL-06 to LL-10). Do the steps in sequence. Each step gives the name of the test that fails if you do not do the step.

## 1. Agree on the rule with the owner

The rule must already be in `RULEBOOK.md` with these fields: `Law`, `Region`, `Phase`, `Fix (full|partial)`, `Detection (static, runtime, intake)`, `Trap`, `Applies when`, `Exposure`, `Detection confidence`. `tests/rulebook-sync.test.ts` parses these bullets. If the rulebook entry does not have a field, ask the owner. Do not write the field yourself.

In `DECISIONS.md`, add a new `## LL-0N` heading. Under it, write how you understand the detection notes:

- What is the trap.
- What is the fix.
- What you decided not to include.

## 2. Create the rule folder

```
packages/rules/src/LL-0N-<slug>/
  index.ts      defineRule(...): metadata, applicability, detectors
  legal.yaml    copy of the text in RULEBOOK.md
  fix.yaml      guidance for a coding agent
  static.ts     detectStatic(repo, ctx), if the rule has static detection
  runtime.ts    detectRuntime(site, ctx), if the rule has runtime detection
```

Diagram 11 in `docs/architecture.md` shows how these files connect. Diagram 3 shows how the engine changes the result of a detector into a status. Copy the shape of a rule that exists:

- `LL-03-session-replay` has the two modes.
- `LL-05-dmca-agent` shows applicability that comes from intake, and evidence of absence.

### index.ts

```ts
export const ll0N = defineRule({
  meta: {
    id: 'LL-0N',
    name: '…',            // the same text as the rulebook heading after "LL-0N · "
    law: '…',             // the same text as the Law field of the rulebook
    regions: ['US'],      // the Region field of the rulebook
    phase: 2,
    fixType: 'partial',   // must be the same as the fixType in fix.yaml
    detection: ['static', 'runtime'],
    topics: ['…'],        // words that a coding agent uses for the work it starts. preflight_check uses them.
    notTopics: ['…'],     // phrases that contain a topic word but have a different meaning
  },
  legalYaml,
  fixYaml,
  applies: (intake) => …, // yes, no, or unknown with the missing intake keys
  detectStatic,
  detectRuntime,
});
```

When the rules package loads, `defineRule` validates the two YAML files with zod. It also makes sure that `ruleId`, `name`, `law` and `fixType` agree with the metadata. If they do not agree, the import of the rules package throws an error.

### Applicability

`applies(intake)` returns `{ value, reason, missing? }`. If a question has no answer, the value is `unknown`, and `missing` gives the intake keys. The value is never `no` in this condition. Where applicable, use the functions that exist:

- `appliesToUsVisitors` and `appliesWithFlag` in `shared/applicability.ts`.
- `appliesToEuVisitors` in core.

If the rule needs a new intake question, add it at three locations:

1. `intakeSchema` in `packages/core/src/schemas.ts`.
2. `INTAKE_QUESTIONS` in `packages/core/src/intake.ts`. `legal-lint init` also uses this list.
3. One line in `DECISIONS.md`.

### Detectors

- `detectStatic(repo, ctx)` reads the `RepoIndex`. The index does not include files that do not ship. For JS/TS, use the AST helpers that core exports: `parseSource`, `walk`, `calleeText`, `objectProp`, `stringValue`, `importsOf` and others. For HTML and CSS, remove the comments first with `stripHtmlComments` and `stripCssComments`.
- `detectRuntime(site, ctx)` is a pure function of the `SiteCapture`. The capture has the requests, cookies, websockets, and the HTML and text of each page. If the rule needs a page that the crawler does not visit, extend `RELEVANT_LINK` in `packages/core/src/runtime/crawler.ts`. Write a note about it in `DECISIONS.md`.
- Return `RawFinding` objects:
  - `key`: a file or page path. Never use a line number. The key becomes the stable finding id.
  - Give one finding for each file (static) or for each site (runtime). Put each location in the evidence.
  - `explanation`: two sentences. The first tells what the detector saw. The second tells the risk.
  - `needsIntake`: use it when this finding needs an answer that the check at rule level does not include.
  - `judgment`: use it when a person or an agent must make a decision (see LL-02). Give options with `outcome: 'open' | 'drop'`, and the material that is necessary for the answer.

## 3. Write legal.yaml

Copy `Trap`, `Applies when`, `Exposure` and `Detection confidence` from the rulebook. **Each character must be the same.** We write these fields ourselves:

- `doesNotApplyIf`: one sentence that comes from "Applies when".
- `exposureKind`: `statutory_max`, `named_case` or `consequence`.
- `sources: []`, `lastReviewed: null` and `reviewStatus: draft`. Keep these values until the lawyer does a review.

In `LEGAL_REVIEW.md`, add a new heading for the rule. Under it, add `doesNotApplyIf`, the `exposureKind` label and the text of the explanations.

## 4. Write fix.yaml

The reader of this file is a coding agent, not a lawyer.

- `goal`: how the product looks after the fix.
- `steps`: each step has a `title`, a `why` and `instructions`. The `why` lets the agent change the step when the repo has a different shape. Use `variants` for instructions that are specific to a framework. The keys are `next-app`, `next-pages`, `vite-react`, `remix`, `node-server` and `plain-html`. Put Next.js first.
- `doneWhen`: conditions that are true after the fix. The last condition must be "A repo re-scan shows no LL-0N finding."
- `ownerSteps`: tasks that only the owner can do, for example register, confirm terms, or write real content. Each task has a `why`.

## 5. Register the rule

Add the rule to `packages/rules/src/index.ts`. Add it to the export and to the `rules` array, in the sequence of the ids. All other parts get the rule from there: the CLI, `--rule`, the MCP tools, the HTML report and the fixture tests.

## 6. Fixtures

Put the fixtures in `fixtures/LL-0N/`. For each detection mode (static, runtime), add:

- Two or more `fires-*` fixtures. Use different frameworks or different types of the mistake. Each fixture has a `.fixed` twin. The twin is the same project after you follow `fix.yaml` manually.
- Two or more `pass-*` and `near-miss-*` fixtures in total. A `pass-*` fixture does the correct thing. A `near-miss-*` fixture looks like the trap but is not the trap.
- `intake-*` fixtures for missing and negative intake answers.
- `judgment-*` fixtures, if the rule asks judgment questions.

Each fixture has a `legal-lint.config.json`, but not when the fixture tests missing intake. Each fixture also has an `expect.json`:

```json
{
  "description": "What this fixture proves, in one line",
  "mode": "static",
  "expect": [
    { "status": "open", "confidence": "high", "evidence": [{ "file": "app/layout.tsx", "line": 12 }] }
  ]
}
```

Runtime fixtures put the site in `site/`. They expect `{ "requestUrl": "…" }` evidence. Findings about absence expect `{ "absent": "<observed text>" }`. Fixture sites must not connect to the network. In tests, the crawler runs offline. It still records outside requests, but it answers them locally with an empty response. Thus you can use vendor URLs in fixtures.

`tests/fixture-meta.test.ts` fails until the fixtures have the minimum coverage. The quiet test for all rules also runs your new detector on the pass, near-miss and fixed fixtures of all other rules. Thus a finding there is a real false positive.

Do a mutation check on each condition in the detector (see `CONTRIBUTING.md`).

## 7. Preflight topics

Add rows to the `CASES` table in `tests/preflight.test.ts`:

- Phrases that an agent uses for this feature. These rows expect your rule.
- Near misses. These rows must not give your rule.

Change `topics` and `notTopics` until the table passes. In `DECISIONS.md`, write each topic that you added or removed, and the reason.

## 8. Finish

- README: add the rule to the table at the top.
- `CHANGELOG.md`: add the rule under "Unreleased".
- Run `pnpm typecheck && pnpm build && pnpm test`.
- If the rule has runtime detection, the hosted API needs no change. The API returns the raw capture and the CLI runs the rules. If you changed the crawler or `SiteCapture`, read the compatibility note in `RELEASING.md`.
