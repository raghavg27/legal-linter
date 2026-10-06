import path from 'node:path';
import { findingId } from './finding-id.ts';
import { intakeQuestions, loadConfig } from './intake.ts';
import { contentHash, type StoredJudgments } from './judgments.ts';
import { captureSite, type CaptureOptions } from './runtime/crawler.ts';
import { buildRepoIndex } from './static/repo-index.ts';
import type {
  ApplicabilityResult,
  DetectContext,
  Finding,
  Intake,
  RawFinding,
  Rule,
  RuleRun,
  ScanReport,
  SiteCapture,
} from './types.ts';

export const DISCLAIMER =
  'Legal Lint describes what it observed and the risk it may create. It is not legal advice.';

export interface ScanOptions {
  rules: readonly Rule[];
  toolVersion: string;
  /**
   * Intake answers. undefined: read legal-lint.config.json from the scanned
   * directory (or cwd for URL scans). null: no intake.
   */
  intake?: Intake | null;
  /** Stored answers to judgment questions. undefined: read from the same config file. */
  judgments?: StoredJudgments;
  /** Only run these rule ids. */
  only?: readonly string[];
}

const CONFIDENCE_ORDER = { high: 0, medium: 1, low: 2 } as const;
const STATUS_ORDER = { open: 0, needs_judgment: 1, needs_intake: 2 } as const;

/** Turns a detector result into a finding, or null when a stored judgment drops it. */
function toFinding(
  rule: Rule,
  raw: RawFinding,
  applicability: ApplicabilityResult,
  judgments: StoredJudgments,
): Finding | null {
  const base = {
    id: findingId(rule.meta.id, raw.key),
    ruleId: rule.meta.id,
    ruleName: rule.meta.name,
    confidence: raw.confidence,
    evidence: raw.evidence,
    explanation: raw.explanation,
    doesNotApplyIf: rule.legal.doesNotApplyIf,
    exposure: { text: rule.legal.exposure, kind: rule.legal.exposureKind },
    fixType: rule.meta.fixType,
  };

  const missing = [...new Set([...(applicability.value === 'unknown' ? (applicability.missing ?? []) : []), ...(raw.needsIntake ?? [])])];
  if (missing.length > 0) return { ...base, status: 'needs_intake', questions: intakeQuestions(missing) };

  if (raw.judgment) {
    const hash = contentHash(raw.judgment.material);
    const stored = judgments[base.id];
    const option = stored?.contentHash === hash ? raw.judgment.options.find((o) => o.value === stored.answer) : undefined;
    if (!option) return { ...base, status: 'needs_judgment', judgment: { ...raw.judgment, contentHash: hash } };
    if (option.outcome === 'drop') return null;
    // The open question was the only reason for doubt; someone has now read the material.
    return { ...base, confidence: 'high', status: 'open' };
  }
  return { ...base, status: 'open' };
}

function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence] ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.id.localeCompare(b.id),
  );
}

function summarise(findings: Finding[]): ScanReport['summary'] {
  return {
    open: findings.filter((f) => f.status === 'open').length,
    needsJudgment: findings.filter((f) => f.status === 'needs_judgment').length,
    needsIntake: findings.filter((f) => f.status === 'needs_intake').length,
  };
}

async function resolveConfig(
  opts: ScanOptions,
  dir: string,
): Promise<{ intake: Intake | null; judgments: StoredJudgments }> {
  const needsFile = opts.intake === undefined || opts.judgments === undefined;
  const config = needsFile ? await loadConfig(dir) : null;
  return {
    intake: opts.intake !== undefined ? opts.intake : (config?.intake ?? null),
    judgments: opts.judgments ?? config?.judgments ?? {},
  };
}

async function runRules(
  rules: readonly Rule[],
  intake: Intake | null,
  judgments: StoredJudgments,
  detect: (rule: Rule, ctx: DetectContext) => Promise<RawFinding[]> | RawFinding[],
): Promise<{ findings: Finding[]; rulesRun: RuleRun[] }> {
  const findings: Finding[] = [];
  const rulesRun: RuleRun[] = [];
  for (const rule of rules) {
    const applicability = rule.applies(intake);
    const run: RuleRun = { id: rule.meta.id, applies: applicability.value, reason: applicability.reason };
    rulesRun.push(run);
    if (applicability.value === 'no') continue;
    try {
      for (const raw of await detect(rule, { intake })) {
        const finding = toFinding(rule, raw, applicability, judgments);
        if (finding) findings.push(finding);
      }
    } catch (e) {
      // One broken detector must not hide the other rules' findings.
      run.error = (e as Error).message;
    }
  }
  return { findings: sortFindings(findings), rulesRun };
}

function selectRules(opts: ScanOptions, has: (r: Rule) => boolean): Rule[] {
  return opts.rules.filter((r) => has(r) && (!opts.only || opts.only.includes(r.meta.id)));
}

export async function scanRepo(root: string, opts: ScanOptions): Promise<ScanReport> {
  const absRoot = path.resolve(root);
  const { intake, judgments } = await resolveConfig(opts, absRoot);
  const repo = await buildRepoIndex(absRoot);
  const rules = selectRules(opts, (r) => typeof r.detectStatic === 'function');
  const { findings, rulesRun } = await runRules(rules, intake, judgments, (rule, ctx) => rule.detectStatic!(repo, ctx));
  return {
    tool: { name: 'legal-lint', version: opts.toolVersion },
    target: { kind: 'repo', root: absRoot, filesScanned: repo.files.length },
    intake: intake ? 'loaded' : 'missing',
    rulesRun,
    findings,
    summary: summarise(findings),
    disclaimer: DISCLAIMER,
  };
}

/** Runs runtime rules over an existing capture. Split from scanSite so rules can be tested on saved captures. */
export async function evaluateCapture(capture: SiteCapture, opts: ScanOptions): Promise<ScanReport> {
  const { intake, judgments } = await resolveConfig(opts, process.cwd());
  const rules = selectRules(opts, (r) => typeof r.detectRuntime === 'function');
  const { findings, rulesRun } = await runRules(rules, intake, judgments, (rule, ctx) => rule.detectRuntime!(capture, ctx));
  return {
    tool: { name: 'legal-lint', version: opts.toolVersion },
    target: { kind: 'url', url: capture.startUrl, pagesVisited: capture.pages.filter((p) => !p.error).map((p) => p.finalUrl) },
    intake: intake ? 'loaded' : 'missing',
    rulesRun,
    findings,
    summary: summarise(findings),
    disclaimer: DISCLAIMER,
  };
}

export async function scanSite(
  url: string,
  opts: ScanOptions & { capture?: Omit<CaptureOptions, 'toolVersion'> },
): Promise<ScanReport> {
  const capture = await captureSite(url, { ...opts.capture, toolVersion: opts.toolVersion });
  const start = capture.pages[0];
  if (!start || start.error) throw new Error(`Could not load ${url}: ${start?.error ?? 'no response'}`);
  return evaluateCapture(capture, opts);
}
