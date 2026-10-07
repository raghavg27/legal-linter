import type ts from 'typescript';
import type { FixGuidance, Framework, Intake, LegalText } from './schemas.ts';

export type { FixGuidance, Framework, Intake, LegalText, LegalLintConfig } from './schemas.ts';

export type Confidence = 'high' | 'medium' | 'low';
export type Applicability = 'yes' | 'no' | 'unknown';
export type FixType = 'full' | 'partial';
export type DetectionMethod = 'static' | 'runtime' | 'intake';
export type Region = 'EU' | 'US' | 'India' | 'App stores';

export interface RuleMeta {
  id: string;
  name: string;
  law: string;
  regions: Region[];
  phase: 1 | 2 | 3;
  fixType: FixType;
  detection: DetectionMethod[];
  /** Words that a coding agent can use for the work that it will start. The pre-flight check uses them. */
  topics: string[];
  /** Phrases that contain a topic word but have a different meaning ("font size" for the fonts rule). The matching ignores them. */
  notTopics?: string[];
}

export interface ApplicabilityResult {
  value: Applicability;
  reason: string;
  /** Intake questions that would change "unknown" into yes or no. */
  missing?: (keyof Intake)[];
}

/** The data that a detector can read in addition to the repo or the capture. */
export interface DetectContext {
  intake: Intake | null;
}

export interface Rule {
  meta: RuleMeta;
  legal: LegalText;
  fix: FixGuidance;
  applies(intake: Intake | null): ApplicabilityResult;
  detectStatic?(repo: RepoIndex, ctx: DetectContext): Promise<RawFinding[]>;
  detectRuntime?(site: SiteCapture, ctx: DetectContext): RawFinding[];
}

// ---------- Evidence and findings ----------

export interface StaticEvidence {
  kind: 'static';
  file: string;
  startLine: number;
  endLine: number;
  snippet: string;
  observed: string;
}

export interface RuntimeEvidence {
  kind: 'runtime';
  pageUrl: string;
  requestUrl: string;
  resourceType: string;
  /** Milliseconds between the start of the navigation and the request. No interaction occurred at any time. */
  msSinceNavigation: number;
  observed: string;
}

export interface AbsenceEvidence {
  kind: 'absence';
  looked: string[];
  observed: string;
}

export type Evidence = StaticEvidence | RuntimeEvidence | AbsenceEvidence;

/** The result of a detector. The engine changes it into a Finding. */
export interface RawFinding {
  /** Stable in the rule (usually a file path or page path). Never contains a line number. */
  key: string;
  confidence: Confidence;
  evidence: Evidence[];
  /** Two sentences: what the detector saw, then the risk that it causes. */
  explanation: string;
  /** This finding depends on intake answers that the check at rule level does not include. */
  needsIntake?: (keyof Intake)[];
  /** The detector cannot make the decision alone. The host agent answers this. The engine adds the content hash. */
  judgment?: Omit<JudgmentRequest, 'contentHash'>;
}

export interface IntakeQuestion {
  key: keyof Intake;
  question: string;
}

export interface JudgmentOption {
  value: string;
  /** open: the finding stays (at high confidence). drop: the finding is removed. */
  outcome: 'open' | 'drop';
  meaning: string;
}

export interface JudgmentRequest {
  question: string;
  options: JudgmentOption[];
  material: { label: string; file?: string; lines?: [number, number]; content: string }[];
  contentHash: string;
}

export interface FindingBase {
  id: string;
  ruleId: string;
  ruleName: string;
  confidence: Confidence;
  evidence: Evidence[];
  explanation: string;
  doesNotApplyIf: string;
  exposure: { text: string; kind: LegalText['exposureKind'] };
  fixType: FixType;
}

export type Finding =
  | (FindingBase & { status: 'open' })
  | (FindingBase & { status: 'needs_intake'; questions: IntakeQuestion[] })
  | (FindingBase & { status: 'needs_judgment'; judgment: JudgmentRequest });

export type FindingStatus = Finding['status'];

export interface RuleRun {
  id: string;
  name: string;
  applies: Applicability;
  reason: string;
  error?: string;
}

export interface ScanReport {
  tool: { name: 'legal-lint'; version: string };
  target:
    | { kind: 'repo'; root: string; filesScanned: number }
    | { kind: 'url'; url: string; pagesVisited: string[] };
  intake: 'loaded' | 'missing';
  rulesRun: RuleRun[];
  findings: Finding[];
  summary: { open: number; needsJudgment: number; needsIntake: number };
  disclaimer: string;
}

// ---------- What detectors read ----------

export interface PackageInfo {
  /** The directory of the package.json, relative to the repo root ("" for the root). */
  dir: string;
  name?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export interface RepoIndex {
  root: string;
  /** POSIX paths relative to root, after the .gitignore and build-output exclusions. */
  files: readonly string[];
  read(file: string): Promise<string>;
  /** The parsed JS/TS/JSX/TSX file, or null for all other file types. */
  sourceFile(file: string): Promise<ts.SourceFile | null>;
  packages: readonly PackageInfo[];
  hasDependency(name: string): boolean;
  frameworks: readonly Framework[];
}

export interface CapturedRequest {
  url: string;
  method: string;
  resourceType: string;
  msSinceNavigation: number;
}

export interface CapturedCookie {
  name: string;
  domain: string;
  path: string;
}

export interface PageCapture {
  url: string;
  finalUrl: string;
  status: number | null;
  requests: CapturedRequest[];
  cookies: CapturedCookie[];
  text: string;
  html: string;
  links: { href: string; text: string }[];
  error?: string;
}

/** All the data that the crawler recorded on a site. The crawler never clicks, types or scrolls. Thus all of it occurred before consent. */
export interface SiteCapture {
  startUrl: string;
  userAgent: string;
  pages: PageCapture[];
}
