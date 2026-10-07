# Adding a rule

The recipe for adding a rule, for example a phase 2 rule (LL-06 to LL-10). Follow it in order. Each step names the test that will fail if it is skipped.

## 1. Agree the rule with the owner

The rule must already be in `RULEBOOK.md`, with these fields: `Law`, `Region`, `Phase`, `Fix (full|partial)`, `Detection (static, runtime, intake)`, `Trap`, `Applies when`, `Exposure`, `Detection confidence`. `tests/rulebook-sync.test.ts` parses those bullets. If the rulebook entry is missing a field, ask; don't invent one.

Write down in `DECISIONS.md` (under a new `## LL-0N` heading) how you read the detection notes: what counts as the trap, what counts as the fix, and what you chose to leave out.

## 2. Create the rule folder

```
packages/rules/src/LL-0N-<slug>/
  index.ts      defineRule(...) — metadata, applicability, detectors
  legal.yaml    copied from RULEBOOK.md
  fix.yaml      guidance for a coding agent
  static.ts     detectStatic(repo, ctx), if the rule has static detection
  runtime.ts    detectRuntime(site, ctx), if the rule has runtime detection
```

Diagram 11 in `docs/architecture.md` shows how these files come together, and diagram 3 shows how the engine turns a detector's result into a status. Copy the shape of an existing rule. `LL-03-session-replay` has both modes; `LL-05-dmca-agent` shows intake-driven applicability and absence evidence.

### index.ts

```ts
export const ll0N = defineRule({
  meta: {
    id: 'LL-0N',
    name: '…',            // exactly the rulebook heading after "LL-0N · "
    law: '…',             // exactly the rulebook's Law field
    regions: ['US'],      // the rulebook's Region field
    phase: 2,
    fixType: 'partial',   // must equal fix.yaml's fixType
    detection: ['static', 'runtime'],
    topics: ['…'],        // what a coding agent says it is building; drives preflight_check
    notTopics: ['…'],     // phrases that contain a topic word but mean something else
  },
  legalYaml,
  fixYaml,
  applies: (intake) => …, // yes / no / unknown with the missing intake keys
  detectStatic,
  detectRuntime,
});
```

`defineRule` validates both YAML files with zod at load time and checks that `ruleId`, `name`, `law` and `fixType` agree with the metadata. A mismatch throws when the rules package is imported.

### Applicability

`applies(intake)` returns `{ value, reason, missing? }`. An unanswered question is `unknown` with `missing` listing the intake keys, never `no`. Reuse `shared/applicability.ts` (`appliesToUsVisitors`, `appliesWithFlag`) or core's `appliesToEuVisitors` where they fit.

If the rule needs an intake question that does not exist yet, add it in three places: `intakeSchema` in `packages/core/src/schemas.ts`, `INTAKE_QUESTIONS` in `packages/core/src/intake.ts` (which also drives `legal-lint init`), and a line in `DECISIONS.md`.

### Detectors

- `detectStatic(repo, ctx)` reads the `RepoIndex`. Non-shipping files are already filtered out. For JS/TS, use the AST helpers exported from core (`parseSource`, `walk`, `calleeText`, `objectProp`, `stringValue`, `importsOf`…). For HTML and CSS, strip comments first (`stripHtmlComments`, `stripCssComments`).
- `detectRuntime(site, ctx)` is a pure function of the `SiteCapture`: requests, cookies, websockets, HTML and text per page. If the rule needs a page the crawler does not visit yet, extend `RELEVANT_LINK` in `packages/core/src/runtime/crawler.ts` and note it in `DECISIONS.md`.
- Return `RawFinding`s:
  - `key`: a file or page path, never a line number. It becomes the stable finding id.
  - one finding per file (static) or per site (runtime), with every location as evidence;
  - `explanation`: two sentences, what was observed and then the risk;
  - `needsIntake` when this finding depends on an answer the rule-level check does not cover;
  - `judgment` when a person or agent must decide (see LL-02). Give options with `outcome: 'open' | 'drop'` and the material needed to answer.

## 3. Write legal.yaml

Copy `Trap`, `Applies when`, `Exposure` and `Detection confidence` from the rulebook **character for character**. The fields that are ours:

- `doesNotApplyIf`: one sentence derived from "Applies when".
- `exposureKind`: `statutory_max`, `named_case` or `consequence`.
- `sources: []`, `lastReviewed: null`, `reviewStatus: draft` until the lawyer reviews it.

Add `doesNotApplyIf`, the `exposureKind` label and the explanation wording to `LEGAL_REVIEW.md` under a new heading for the rule.

## 4. Write fix.yaml

Written for a coding agent, not a lawyer:

- `goal`: what the fixed product looks like.
- `steps`: each with a `title`, a `why` (so the agent can adapt when the repo is shaped differently) and `instructions`. Use `variants` for framework-specific instructions. The keys are `next-app`, `next-pages`, `vite-react`, `remix`, `node-server` and `plain-html`; put Next.js first.
- `doneWhen`: checks that are true after the fix. The last one should be "A repo re-scan reports no LL-0N finding."
- `ownerSteps`: things only the owner can do (register, confirm terms, write real content), each with a `why`.

## 5. Register the rule

Add it to `packages/rules/src/index.ts`, both to the export and to the `rules` array, in id order. Everything else picks it up from there: the CLI, `--rule`, the MCP tools, the HTML report and the fixture tests.

## 6. Fixtures

Under `fixtures/LL-0N/`. For each detection mode (static, runtime):

- `fires-*` (at least two, different frameworks or different ways of making the mistake), each with a `.fixed` twin that is the same project after following `fix.yaml` by hand;
- `pass-*` (does the right thing) and `near-miss-*` (looks like the trap but isn't), at least two in total;
- `intake-*` for missing and negative intake answers;
- `judgment-*` if the rule asks judgment questions.

Each fixture has `legal-lint.config.json` (unless it tests missing intake) and an `expect.json`:

```json
{
  "description": "What this fixture proves, in one line",
  "mode": "static",
  "expect": [
    { "status": "open", "confidence": "high", "evidence": [{ "file": "app/layout.tsx", "line": 12 }] }
  ]
}
```

Runtime fixtures put the site in `site/` and expect `{ "requestUrl": "…" }` evidence. Absence findings expect `{ "absent": "<observed text>" }`. Fixture sites must not reach the network. In tests the crawler runs offline: outside requests are still recorded but answered locally with an empty response, so reference vendor URLs freely.

`tests/fixture-meta.test.ts` fails until the coverage minimums are met. The cross-rule quiet test also runs your new detector over every other rule's pass, near-miss and fixed fixtures, so a misfire there is a real false positive.

Mutation-check each condition in the detector (see `CONTRIBUTING.md`).

## 7. Preflight topics

Add rows to the `CASES` table in `tests/preflight.test.ts`: phrases an agent would use for this feature (expecting your rule), and near misses that must stay quiet. Tune `topics` and `notTopics` until the table passes, and record any topic you added or removed, and why, in `DECISIONS.md`.

## 8. Finish

- README: add the rule to the table at the top.
- `CHANGELOG.md`: add the rule under "Unreleased".
- `pnpm typecheck && pnpm build && pnpm test`.
- If the rule has runtime detection, the hosted API needs no change: it returns the raw capture and the CLI runs the rules. If the crawler or `SiteCapture` changed, see the compatibility note in `RELEASING.md`.
