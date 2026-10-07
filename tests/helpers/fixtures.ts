import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Confidence, Finding, FindingStatus } from '@legal-lint/core';

export const FIXTURES_DIR = path.resolve(import.meta.dirname, '../../fixtures');

export type FixtureCategory = 'fires' | 'pass' | 'near-miss' | 'intake' | 'judgment';

export type ExpectedEvidence = { file: string; line: number } | { requestUrl: string } | { absent: string };

export interface ExpectedFinding {
  status: FindingStatus;
  confidence: Confidence;
  evidence: ExpectedEvidence[];
}

export interface Fixture {
  ruleId: string;
  /** Folder name, for example "fires-vite-css-import.fixed". */
  name: string;
  dir: string;
  category: FixtureCategory;
  /** A fixed twin: the fixture that fires, after a person followed its fix guidance manually. */
  fixed: boolean;
  mode: 'static' | 'runtime';
  description: string;
  expect: ExpectedFinding[];
}

const CATEGORIES: FixtureCategory[] = ['fires', 'pass', 'near-miss', 'intake', 'judgment'];

function categoryOf(name: string): FixtureCategory {
  const base = name.replace(/\.fixed$/, '');
  const found = CATEGORIES.find((c) => base.startsWith(`${c}-`));
  if (!found) throw new Error(`Fixture "${name}" must start with one of: ${CATEGORIES.map((c) => `${c}-`).join(', ')}`);
  return found;
}

export function loadFixtures(): Fixture[] {
  const fixtures: Fixture[] = [];
  for (const ruleId of readdirSync(FIXTURES_DIR).filter((d) => /^LL-\d{2}$/.test(d)).sort()) {
    const ruleDir = path.join(FIXTURES_DIR, ruleId);
    for (const name of readdirSync(ruleDir).sort()) {
      const dir = path.join(ruleDir, name);
      const expectFile = path.join(dir, 'expect.json');
      if (!existsSync(expectFile)) throw new Error(`${ruleId}/${name} has no expect.json`);
      const spec = JSON.parse(readFileSync(expectFile, 'utf8')) as Pick<Fixture, 'mode' | 'description' | 'expect'>;
      fixtures.push({
        ruleId,
        name,
        dir,
        category: categoryOf(name),
        fixed: name.endsWith('.fixed'),
        mode: spec.mode,
        description: spec.description,
        expect: spec.expect,
      });
    }
  }
  return fixtures;
}

/** Changes real findings to the shape in expect.json, in a stable sequence. */
export function toComparable(findings: Finding[]): ExpectedFinding[] {
  const shaped = findings.map((f) => ({
    status: f.status,
    confidence: f.confidence,
    evidence: f.evidence.map((e): ExpectedEvidence => {
      if (e.kind === 'static') return { file: e.file, line: e.startLine };
      if (e.kind === 'runtime') return { requestUrl: e.requestUrl };
      return { absent: e.observed };
    }),
  }));
  return sortComparable(shaped);
}

export function sortComparable(list: ExpectedFinding[]): ExpectedFinding[] {
  return [...list].sort((a, b) => JSON.stringify(a.evidence).localeCompare(JSON.stringify(b.evidence)));
}
