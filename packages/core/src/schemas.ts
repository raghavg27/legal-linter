import { z } from 'zod';

// Data files a non-programmer can review (legal.yaml, fix.yaml) and the
// per-project config are validated against these schemas at load time.

export const FRAMEWORKS = [
  'next-app',
  'next-pages',
  'vite-react',
  'remix',
  'node-server',
  'plain-html',
] as const;

export const frameworkSchema = z.enum(FRAMEWORKS);

export const legalTextSchema = z
  .object({
    ruleId: z.string().regex(/^LL-\d{2}$/),
    name: z.string().min(1),
    law: z.string().min(1),
    trap: z.string().min(1),
    appliesWhen: z.string().min(1),
    // Written by us from appliesWhen, not copied from the rulebook. Listed in LEGAL_REVIEW.md.
    doesNotApplyIf: z.string().min(1),
    exposure: z.string().min(1),
    exposureKind: z.enum(['statutory_max', 'named_case', 'consequence']),
    detectionConfidence: z.string().min(1),
    sources: z.array(z.object({ title: z.string(), url: z.url() })),
    lastReviewed: z.iso.date().nullable(),
    reviewStatus: z.enum(['draft', 'lawyer_reviewed']),
  })
  .strict();

const fixStepSchema = z
  .object({
    title: z.string().min(1),
    why: z.string().min(1),
    instructions: z.string().min(1),
    variants: z.partialRecord(frameworkSchema, z.string().min(1)).optional(),
  })
  .strict();

export const fixGuidanceSchema = z
  .object({
    ruleId: z.string().regex(/^LL-\d{2}$/),
    fixType: z.enum(['full', 'partial']),
    goal: z.string().min(1),
    steps: z.array(fixStepSchema).min(1),
    doneWhen: z.array(z.string().min(1)).min(1),
    ownerSteps: z.array(z.object({ title: z.string().min(1), why: z.string().min(1) }).strict()),
  })
  .strict();

// Every field is optional: an unanswered question means "unknown", never "no".
export const intakeSchema = z
  .object({
    countries: z.array(z.string().length(2).toUpperCase()).optional(),
    euUkVisitors: z.boolean().optional(),
    audience: z.enum(['general', 'teens', 'under13', 'mixed']).optional(),
    revenueBand: z.string().optional(),
    userCount: z.string().optional(),
    sellsSubscriptions: z.boolean().optional(),
    sendsMarketingEmail: z.boolean().optional(),
    sendsMarketingSms: z.boolean().optional(),
    hostsPublicUploads: z.boolean().optional(),
    dmcaAgentRegistered: z.boolean().optional(),
    handlesHealthData: z.boolean().optional(),
    servesVideo: z.boolean().optional(),
    shipsMobileApps: z.boolean().optional(),
  })
  .strict();

export const configSchema = z.object({
  intake: intakeSchema.optional(),
  judgments: z
    .record(
      z.string(),
      z.object({
        answer: z.string(),
        contentHash: z.string(),
        answeredAt: z.string(),
        // Who answered (for example "agent") and why, so a reviewer can check the call later.
        answeredBy: z.string().optional(),
        reason: z.string().optional(),
      }),
    )
    .optional(),
  licenceKey: z.string().optional(),
});

export type LegalText = z.infer<typeof legalTextSchema>;
export type FixGuidance = z.infer<typeof fixGuidanceSchema>;
export type Intake = z.infer<typeof intakeSchema>;
export type LegalLintConfig = z.infer<typeof configSchema>;
export type Framework = z.infer<typeof frameworkSchema>;
