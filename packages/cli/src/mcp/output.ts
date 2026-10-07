import { z } from 'zod';
import { FRAMEWORKS } from '@legal-lint/core';

// Output schemas for the MCP tools. They are the same as the finding types in
// @legal-lint/core. The SDK checks each result against them. Thus, if the engine and
// the data that agents expect become different, the tests fail.

const confidence = z.enum(['high', 'medium', 'low']);
const applicability = z.enum(['yes', 'no', 'unknown']);
const exposure = z.object({
  text: z.string(),
  kind: z.enum(['statutory_max', 'named_case', 'consequence']).describe('statutory_max: a statutory maximum. named_case: from a named court case. consequence: what happens, not an amount.'),
});
const intakeQuestion = z.object({ key: z.string(), question: z.string() });

const evidence = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('static'), file: z.string(), startLine: z.number(), endLine: z.number(), snippet: z.string(), observed: z.string() }),
  z.object({
    kind: z.literal('runtime'),
    pageUrl: z.string(),
    requestUrl: z.string(),
    resourceType: z.string(),
    msSinceNavigation: z.number(),
    observed: z.string(),
  }),
  z.object({ kind: z.literal('absence'), looked: z.array(z.string()), observed: z.string() }),
]);

const findingBase = z.object({
  id: z.string(),
  ruleId: z.string(),
  ruleName: z.string(),
  confidence,
  evidence: z.array(evidence),
  explanation: z.string(),
  doesNotApplyIf: z.string(),
  exposure,
  fixType: z.enum(['full', 'partial']),
});

export const judgmentSchema = z.object({
  question: z.string(),
  options: z.array(z.object({ value: z.string(), outcome: z.enum(['open', 'drop']), meaning: z.string() })),
  material: z.array(
    z.object({
      label: z.string(),
      file: z.string().optional(),
      lines: z.tuple([z.number(), z.number()]).optional(),
      content: z.string(),
      truncated: z.boolean().optional().describe('true when content was cut; read the file for the rest'),
    }),
  ),
  contentHash: z.string().describe('pass this back to answer_judgment unchanged'),
});

export const findingSchema = z.discriminatedUnion('status', [
  findingBase.extend({ status: z.literal('open') }),
  findingBase.extend({ status: z.literal('needs_intake'), questions: z.array(intakeQuestion) }),
  findingBase.extend({ status: z.literal('needs_judgment'), judgment: judgmentSchema }),
]);

/** A finding as the MCP tools return it: the finding of the engine, with long judgment material cut. */
export type AgentFinding = z.infer<typeof findingSchema>;

const appliesHere = z.object({ value: applicability, reason: z.string(), questions: z.array(intakeQuestion) });

export const scanOutput = z.object({
  target: z.union([
    z.object({ kind: z.literal('repo'), root: z.string(), filesScanned: z.number() }),
    z.object({ kind: z.literal('url'), url: z.string(), pagesVisited: z.array(z.string()) }),
  ]),
  intake: z.enum(['loaded', 'missing']),
  summary: z.object({ open: z.number(), needsJudgment: z.number(), needsIntake: z.number() }),
  rulesRun: z.array(z.object({ id: z.string(), name: z.string(), applies: applicability, reason: z.string(), error: z.string().optional() })),
  findings: z.array(findingSchema),
  htmlReport: z.string().describe('absolute path of the HTML report for the product owner'),
  next: z.array(z.string()),
  disclaimer: z.string(),
});

export const preflightOutput = z.object({
  building: z.string(),
  intake: z.enum(['loaded', 'missing']),
  rules: z.array(
    z.object({
      ruleId: z.string(),
      name: z.string(),
      matchedOn: z.array(z.string()),
      trap: z.string(),
      appliesHere,
      goal: z.string(),
      mustBeTrue: z.array(z.string()),
      ownerSteps: z.array(z.object({ title: z.string(), why: z.string() })),
      doesNotApplyIf: z.string(),
      exposure,
    }),
  ),
  coverage: z.string(),
  next: z.array(z.string()),
  disclaimer: z.string(),
});

export const guidanceOutput = z.object({
  ruleId: z.string(),
  ruleName: z.string(),
  findingId: z.string().optional(),
  fixType: z.enum(['full', 'partial']),
  goal: z.string(),
  frameworks: z.array(z.enum(FRAMEWORKS)),
  steps: z.array(
    z.object({
      title: z.string(),
      why: z.string(),
      instructions: z.string(),
      forFramework: z.partialRecord(z.enum(FRAMEWORKS), z.string()),
    }),
  ),
  doneWhen: z.array(z.string()),
  ownerSteps: z.array(z.object({ title: z.string(), why: z.string() })),
  next: z.array(z.string()),
  disclaimer: z.string(),
});

export const answerJudgmentOutput = z.object({
  findingId: z.string(),
  answer: z.string(),
  outcome: z.enum(['open', 'dropped']),
  finding: findingSchema.optional(),
  configFile: z.string(),
  next: z.array(z.string()),
});

export const answerIntakeOutput = z.object({
  configFile: z.string(),
  intake: z.record(z.string(), z.unknown()),
  rules: z.array(z.object({ ruleId: z.string(), name: z.string(), appliesHere })),
  next: z.array(z.string()),
});

export const explainOutput = z.object({
  ruleId: z.string(),
  name: z.string(),
  law: z.string(),
  regions: z.array(z.string()),
  trap: z.string(),
  appliesWhen: z.string(),
  doesNotApplyIf: z.string(),
  exposure,
  detectionConfidence: z.string(),
  fixType: z.enum(['full', 'partial']),
  appliesHere,
  reviewStatus: z.enum(['draft', 'lawyer_reviewed']),
  lastReviewed: z.string().nullable(),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
  disclaimer: z.string(),
});
