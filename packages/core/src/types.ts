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
  /** Words a coding agent might use for what it is about to build. Used by the pre-flight check. */
  topics: string[];
}

export interface ApplicabilityResult {
  value: Applicability;
  reason: string;
  /** Intake questions that would turn "unknown" into yes or no. */
  missing?: (keyof Intake)[];
}

export interface Rule {
  meta: RuleMeta;
  legal: LegalText;
  fix: FixGuidance;
  applies(intake: Intake | null): ApplicabilityResult;
  detectStatic?(repo: RepoIndex): Promise<RawFinding[]>;
  detectRuntime?(site: SiteCapture): RawFinding[];
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
  /** Milliseconds between the start of navigation and the request. No interaction has happened at any point. */
  msSinceNavigation: number;
  observed: string;
}

export interface AbsenceEvidence {
  kind: 'absence';
  looked: string[];
  observed: string;
}

export type Evidence = StaticEvidence | RuntimeEvidence | AbsenceEvidence;

/** What a detector returns. The engine turns it into a Finding. */
export interface RawFinding {
  /** Stable within the rule (usually a file path or page path). Never includes a line number. */
  key: string;
  confidence: Confidence;
  evidence: Evidence[];
  /** Two sentences: what was observed, then the risk it creates. */
  explanation: string;
}

export interface IntakeQuestion {
  key: keyof Intake;
  question: string;
}

export interface JudgmentRequest {
  question: string;
  options: { value: string; outcome: 'open' | 'drop'; meaning: string }[];
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
  /** Directory of the package.json, relative to the repo root ("" for the root). */
  dir: string;
  name?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export interface RepoIndex {
  root: string;
  /** POSIX paths relative to root, after .gitignore and build-output exclusions. */
  files: readonly string[];
  read(file: string): Promise<string>;
  /** Parsed JS/TS/JSX/TSX file, or null for any other file type. */
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

/** Everything recorded while visiting a site. The crawler never clicks, types or scrolls, so all of it happened before consent. */
export interface SiteCapture {
  startUrl: string;
  userAgent: string;
  pages: PageCapture[];
}
