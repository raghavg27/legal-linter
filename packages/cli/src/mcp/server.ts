import { stat } from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  buildRepoIndex,
  defaultReportPath,
  DISCLAIMER,
  guidanceFor,
  INTAKE_QUESTIONS,
  intakeQuestions,
  intakeSchema,
  loadConfig,
  matchTopics,
  mergeIntake,
  recordJudgment,
  scanRepo,
  writeHtmlReport,
  type ApplicabilityResult,
  type CaptureOptions,
  type Finding,
  type Intake,
  type Rule,
  type ScanReport,
} from '@legal-lint/core';
import { rules } from '@legal-lint/rules';
import {
  answerIntakeOutput,
  answerJudgmentOutput,
  explainOutput,
  guidanceOutput,
  preflightOutput,
  scanOutput,
} from './output.ts';
import { checkLicence, type Licence } from '../licence/gate.ts';
import { defaultRuntime, type RuntimeEnv } from '../licence/store.ts';
import { scanUrl } from '../scan-url.ts';

export interface ServerOptions {
  version: string;
  /** Crawler options for scan_url. Tests pass a shared browser and offline mode. */
  capture?: Omit<CaptureOptions, 'toolVersion'>;
  /** Licence lookup and network access; tests pass their own. */
  runtime?: RuntimeEnv;
}

/** Judgment material longer than this is cut in scan results; the agent can read the file for the rest. */
export const MATERIAL_LIMIT = 2000;

const RULE_IDS = rules.map((r) => r.meta.id) as [string, ...string[]];
const FINDING_ID = /^(LL-\d{2})-[0-9a-f]{10}$/;

const INSTRUCTIONS = `Legal Lint finds legal traps in a codebase or a live site and says how to avoid them. It reports and guides; it never edits code.
Phase 1 covers five traps: Google Fonts loaded from Google in the EU, marketing email with no unsubscribe or postal address, session replay recording before consent, subscriptions that renew without clear terms, and user uploads with no DMCA agent.
How to use it:
- Before adding payments or subscriptions, analytics or session replay, email or SMS sending, user uploads, auth, or fonts, call preflight_check.
- After changing code, call scan_repo. For each open finding, call get_fix_guidance, apply the steps, then call scan_repo again to confirm the finding is gone.
- For a needs_judgment finding, read the material and call answer_judgment.
- For a needs_intake finding, ask the user the question and record their answer with answer_intake. Never guess an answer.
- Tell the user where the HTML report is, so they can see what is left.
- Every tool needs a licence key. If a tool says one is missing, tell the user to set LEGAL_LINT_KEY or run \`legal-lint activate <key>\`.
Results describe observed risk; they are not legal advice, and fixing a finding is not a promise that the product meets the law.`;

const pathParam = z
  .string()
  .optional()
  .describe('Absolute path of the project root (where package.json and legal-lint.config.json live). Defaults to the server working directory.');

function ok<T extends Record<string, unknown>>(data: T) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: data };
}

async function projectDir(p: string | undefined): Promise<string> {
  const dir = path.resolve(p ?? process.cwd());
  const s = await stat(dir).catch(() => null);
  if (!s?.isDirectory()) throw new Error(`Not a directory: ${dir}. Pass the project root as an absolute path.`);
  return dir;
}

function ruleById(id: string): Rule {
  const rule = rules.find((r) => r.meta.id === id);
  if (!rule) throw new Error(`Unknown rule id: ${id}. Known: ${RULE_IDS.join(', ')}`);
  return rule;
}

function appliesHere(a: ApplicabilityResult) {
  return { value: a.value, reason: a.reason, questions: intakeQuestions(a.value === 'unknown' ? (a.missing ?? []) : []) };
}

/** Cuts long judgment material; everything else in a finding is returned in full. */
function forAgent(f: Finding) {
  if (f.status !== 'needs_judgment') return f;
  const material = f.judgment.material.map((m) =>
    m.content.length > MATERIAL_LIMIT ? { ...m, content: m.content.slice(0, MATERIAL_LIMIT), truncated: true } : m,
  );
  return { ...f, judgment: { ...f.judgment, material } };
}

function nextSteps(report: ScanReport, htmlReport: string, scanTool: 'scan_repo' | 'scan_url'): string[] {
  const s = report.summary;
  const next: string[] = [];
  if (s.open) {
    next.push(
      `For each open finding, call get_fix_guidance with its id, apply the steps, then call ${scanTool} again and check the finding is gone.`,
    );
  }
  if (s.needsJudgment) next.push('For each needs_judgment finding, read the material, then call answer_judgment with the finding id, your answer, the contentHash and a one-line reason.');
  if (s.needsIntake) next.push('For each needs_intake finding, ask the user the question (do not guess), then record the answer with answer_intake.');
  if (next.length === 0) next.push('No findings. Nothing to do for the rules that ran.');
  next.push(`Tell the user they can open the HTML report: ${htmlReport}`);
  return next;
}

async function scanResult(report: ScanReport, dir: string, scanTool: 'scan_repo' | 'scan_url') {
  const htmlReport = await writeHtmlReport(report, defaultReportPath(dir));
  return ok({
    target: report.target,
    intake: report.intake,
    summary: report.summary,
    rulesRun: report.rulesRun,
    findings: report.findings.map(forAgent),
    htmlReport,
    next: nextSteps(report, htmlReport, scanTool),
    disclaimer: report.disclaimer,
  });
}

const ruleIdsParam = z.array(z.enum(RULE_IDS)).optional().describe('Only run these rules. Default: all.');

export function createServer(opts: ServerOptions): McpServer {
  const server = new McpServer({ name: 'legal-lint', version: opts.version }, { instructions: INSTRUCTIONS });
  const rt = opts.runtime ?? defaultRuntime();
  // No free tier: every tool checks the licence first (cached, so this is a file read, not a network call).
  const requireLicence = async (): Promise<Licence> => {
    const licence = await checkLicence(rt, opts.version);
    if (licence.warning) process.stderr.write(`legal-lint mcp: ${licence.warning}\n`);
    return licence;
  };

  server.registerTool(
    'preflight_check',
    {
      title: 'Check before building',
      description:
        'Call this BEFORE adding or changing payments or subscriptions, analytics or session replay, email or SMS sending, user uploads, auth, or fonts. ' +
        'Describe what you are about to build in a few words ("Stripe subscriptions", "Hotjar", "newsletter signup", "image uploads"). ' +
        'Returns the Legal Lint rules that cover it, whether they apply to this project, what must be true when you are done, and steps only the owner can take. ' +
        'Legal Lint covers only a few specific traps, so an empty result does not mean the feature is legally clear.',
      inputSchema: z.object({
        building: z.string().min(2).describe('What you are about to build or add, in a few words.'),
        path: pathParam,
      }),
      outputSchema: preflightOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ building, path: p }) => {
      await requireLicence();
      const dir = await projectDir(p);
      const intake = (await loadConfig(dir))?.intake ?? null;
      const matches = matchTopics(building, rules);
      return ok({
        building,
        intake: intake ? 'loaded' : 'missing',
        rules: matches.map(({ rule, matchedOn }) => ({
          ruleId: rule.meta.id,
          name: rule.meta.name,
          matchedOn,
          trap: rule.legal.trap,
          appliesHere: appliesHere(rule.applies(intake)),
          goal: rule.fix.goal,
          mustBeTrue: rule.fix.doneWhen,
          ownerSteps: rule.fix.ownerSteps,
          doesNotApplyIf: rule.legal.doesNotApplyIf,
          exposure: { text: rule.legal.exposure, kind: rule.legal.exposureKind },
        })),
        coverage: `Legal Lint phase 1 checks: ${rules.map((r) => `${r.meta.id} ${r.meta.name}`).join('; ')}.`,
        next: matches.length
          ? [
              'Build it so every item in mustBeTrue holds. Call get_fix_guidance with a rule id for step-by-step guidance for this framework.',
              'Pass ownerSteps to the user; only they can do them.',
              'When done, call scan_repo to confirm nothing is reported.',
              ...(matches.some((m) => m.rule.applies(intake).value === 'unknown')
                ? ['Where appliesHere is unknown, ask the user the questions and record the answers with answer_intake.']
                : []),
            ]
          : ['None of the phase 1 rules matched. Call scan_repo after building to check anyway.'],
        disclaimer: DISCLAIMER,
      });
    },
  );

  server.registerTool(
    'scan_repo',
    {
      title: 'Scan the repository',
      description:
        'Scans the project working tree on this machine for the legal traps Legal Lint knows and returns every finding with the exact file and lines, what was observed, the risk, and when the rule would not apply. ' +
        'Call it after changing code in the areas preflight_check covers, and again after applying fix guidance to confirm a finding is gone. ' +
        'Source code never leaves the machine. Also writes an HTML report for the user to .legal-lint/report.html in the project (that folder ignores itself in git).',
      inputSchema: z.object({ path: pathParam, rules: ruleIdsParam }),
      outputSchema: scanOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path: p, rules: only }) => {
      await requireLicence();
      const dir = await projectDir(p);
      const report = await scanRepo(dir, { rules, toolVersion: opts.version, only });
      return scanResult(report, dir, 'scan_repo');
    },
  );

  server.registerTool(
    'scan_url',
    {
      title: 'Scan a live or preview URL',
      description:
        'Loads a live or preview URL in headless Chromium and reports what happens before any click: requests to Google Fonts, session replay recording, subscription prices without renewal terms. Public URLs are loaded by the Legal Lint hosted scanner (only the URL is sent); localhost and private addresses load on this machine and need Playwright. ' +
        'Visits the page plus up to four linked pricing or legal pages, and never clicks, types or submits. ' +
        'Use it on a running preview after fixing a runtime finding, or when the user asks about a deployed site. Also writes the HTML report.',
      inputSchema: z.object({
        url: z.string().describe('http or https URL, for example http://localhost:3000'),
        path: pathParam.describe('Project root whose legal-lint.config.json answers apply, and where the HTML report goes. Defaults to the server working directory.'),
        rules: ruleIdsParam,
        timeoutMs: z.number().int().min(1000).max(120_000).optional().describe('Page load timeout per page. Default 30000.'),
        local: z.boolean().optional().describe('Load the page with Chromium on this machine instead of the hosted scanner. localhost and private addresses always load locally.'),
      }),
      outputSchema: scanOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ url, path: p, rules: only, timeoutMs, local }) => {
      const licence = await requireLicence();
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error(`Not a valid URL: ${url}`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Only http and https URLs can be scanned.');
      const dir = await projectDir(p);
      const config = await loadConfig(dir);
      const report = await scanUrl(parsed.href, {
        rt,
        licence,
        version: opts.version,
        local,
        only,
        timeoutMs,
        intake: config?.intake ?? null,
        judgments: config?.judgments ?? {},
        capture: opts.capture,
      });
      return scanResult(report, dir, 'scan_url');
    },
  );

  server.registerTool(
    'get_fix_guidance',
    {
      title: 'Get fix guidance',
      description:
        'Returns step-by-step guidance for fixing a finding, picked for the frameworks found in the project (Next.js App or Pages Router, Vite React, Remix, Node server, plain HTML). ' +
        'Each step says why it matters, so you can adapt it when the code does not match the expected shape. ' +
        'Also returns what must be true afterwards and the steps only the owner can do, which you should pass on to the user. Call it before fixing any finding.',
      inputSchema: z.object({
        findingId: z.string().regex(FINDING_ID).optional().describe('Finding id from a scan, e.g. LL-03-1a2b3c4d5e. Either this or ruleId.'),
        ruleId: z.enum(RULE_IDS).optional().describe('Rule id, e.g. LL-03. Either this or findingId.'),
        path: pathParam,
      }),
      outputSchema: guidanceOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ findingId, ruleId, path: p }) => {
      await requireLicence();
      const id = findingId ? FINDING_ID.exec(findingId)![1]! : ruleId;
      if (!id) throw new Error('Pass findingId or ruleId.');
      if (findingId && ruleId && ruleId !== id) throw new Error(`Finding ${findingId} belongs to ${id}, not ${ruleId}.`);
      const rule = ruleById(id);
      const dir = await projectDir(p);
      const repo = await buildRepoIndex(dir);
      const guidance = guidanceFor(rule, repo.frameworks);
      const runtime = rule.meta.detection.includes('runtime');
      return ok({
        ...guidance,
        ruleName: rule.meta.name,
        ...(findingId ? { findingId } : {}),
        next: [
          `Apply the steps, then call scan_repo and check that ${findingId ? `finding ${findingId}` : `no ${rule.meta.id} finding`} is reported.`,
          ...(runtime ? ['If a preview is running, also call scan_url on it, since this rule checks live pages too.'] : []),
          ...(guidance.ownerSteps.length ? ['Tell the user about ownerSteps; only they can do them, and the scan cannot confirm them.'] : []),
        ],
        disclaimer: DISCLAIMER,
      });
    },
  );

  server.registerTool(
    'answer_judgment',
    {
      title: 'Answer a judgment question',
      description:
        'Answers the question on a needs_judgment finding from scan_repo, for example whether an email is marketing or transactional. ' +
        'Read the material in the finding (open the files if it was truncated), pick one of the options, and pass the contentHash you were given. ' +
        'The answer is stored in legal-lint.config.json with your reason, so the user can review it, and is reused until the material changes. ' +
        'Returns whether the finding is now open or dropped.',
      inputSchema: z.object({
        findingId: z.string().regex(FINDING_ID).describe('The needs_judgment finding id.'),
        answer: z.string().describe('One of the option values in the finding, e.g. "marketing" or "transactional".'),
        contentHash: z.string().describe('The judgment.contentHash from the finding, unchanged.'),
        reason: z.string().min(3).describe('One line on why, citing what in the material decided it.'),
        path: pathParam,
      }),
      outputSchema: answerJudgmentOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ findingId, answer, contentHash, reason, path: p }) => {
      await requireLicence();
      const dir = await projectDir(p);
      const ruleId = FINDING_ID.exec(findingId)![1]!;
      // Scan again without stored answers, so the question and the material are current.
      const fresh = await scanRepo(dir, { rules, toolVersion: opts.version, only: [ruleId], judgments: {} });
      const finding = fresh.findings.find((f) => f.id === findingId);
      if (!finding) throw new Error(`No finding ${findingId} in a fresh scan of ${dir}. It may have been fixed or moved; call scan_repo again.`);
      if (finding.status === 'needs_intake') {
        throw new Error(`Finding ${findingId} needs intake answers first: ${finding.questions.map((q) => `${q.key} (${q.question})`).join('; ')}. Ask the user and call answer_intake.`);
      }
      if (finding.status !== 'needs_judgment') throw new Error(`Finding ${findingId} has no judgment question.`);
      if (finding.judgment.contentHash !== contentHash) {
        throw new Error(`The material for ${findingId} changed since it was read (contentHash is now ${finding.judgment.contentHash}). Call scan_repo, read the new material and answer again.`);
      }
      const option = finding.judgment.options.find((o) => o.value === answer);
      if (!option) throw new Error(`"${answer}" is not an option. Choose one of: ${finding.judgment.options.map((o) => o.value).join(', ')}.`);

      const configFile = await recordJudgment(dir, findingId, {
        answer,
        contentHash,
        answeredAt: new Date().toISOString(),
        answeredBy: 'agent',
        reason,
      });
      const after = await scanRepo(dir, { rules, toolVersion: opts.version, only: [ruleId] });
      const now = after.findings.find((f) => f.id === findingId);
      return ok({
        findingId,
        answer,
        outcome: now ? 'open' : 'dropped',
        ...(now ? { finding: forAgent(now) } : {}),
        configFile,
        next: now
          ? [`${findingId} is now an open finding. Call get_fix_guidance with it, apply the steps, and call scan_repo again.`]
          : [`${findingId} is dropped. The answer stays in ${path.basename(configFile)} until the material changes; mention it to the user so they can review it.`],
      });
    },
  );

  const answersSchema = z
    .object(
      Object.fromEntries(
        Object.entries(intakeSchema.shape).map(([key, schema]) => [key, schema.describe(INTAKE_QUESTIONS[key as keyof Intake])]),
      ) as typeof intakeSchema.shape,
    )
    .strict();

  server.registerTool(
    'answer_intake',
    {
      title: 'Record the user’s project answers',
      description:
        'Records the user’s answers to the project questions that decide which rules apply (countries served, EU/UK visitors, subscriptions, marketing email, public uploads and so on) in legal-lint.config.json. ' +
        'Only call it with answers the user gave you. Never guess or infer an answer from the code: an unanswered question keeps findings visible, a wrong answer hides them. ' +
        'Pass only the questions the user answered; earlier answers to other questions are kept.',
      inputSchema: z.object({ answers: answersSchema, path: pathParam }),
      outputSchema: answerIntakeOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ answers, path: p }) => {
      await requireLicence();
      if (Object.keys(answers).length === 0) throw new Error('No answers given.');
      const dir = await projectDir(p);
      const configFile = await mergeIntake(dir, answers);
      const intake = (await loadConfig(dir))?.intake ?? {};
      return ok({
        configFile,
        intake,
        rules: rules.map((r) => ({ ruleId: r.meta.id, name: r.meta.name, appliesHere: appliesHere(r.applies(intake)) })),
        next: ['Call scan_repo again to see findings under the new answers.'],
      });
    },
  );

  server.registerTool(
    'explain_rule',
    {
      title: 'Explain a rule',
      description:
        'Explains one Legal Lint rule in plain language: the trap, the law it comes from, when it applies and when it does not, the exposure, and whether it applies to this project. ' +
        'Call it when the user asks why something was flagged or what a rule means.',
      inputSchema: z.object({ ruleId: z.enum(RULE_IDS).describe('Rule id, e.g. LL-01.'), path: pathParam }),
      outputSchema: explainOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ ruleId, path: p }) => {
      await requireLicence();
      const rule = ruleById(ruleId);
      const dir = await projectDir(p);
      const intake = (await loadConfig(dir))?.intake ?? null;
      const { legal } = rule;
      return ok({
        ruleId,
        name: rule.meta.name,
        law: rule.meta.law,
        regions: rule.meta.regions,
        trap: legal.trap,
        appliesWhen: legal.appliesWhen,
        doesNotApplyIf: legal.doesNotApplyIf,
        exposure: { text: legal.exposure, kind: legal.exposureKind },
        detectionConfidence: legal.detectionConfidence,
        fixType: rule.meta.fixType,
        appliesHere: appliesHere(rule.applies(intake)),
        reviewStatus: legal.reviewStatus,
        lastReviewed: legal.lastReviewed,
        sources: legal.sources,
        disclaimer: DISCLAIMER,
      });
    },
  );

  return server;
}
