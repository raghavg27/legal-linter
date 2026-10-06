import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Confidence, Finding, FindingStatus } from '@legal-lint/core';

export const FIXTURES_DIR = path.resolve(import.meta.dirname, '../../fixtures');

export type FixtureCategory = 'fires' | 'pass' | 'near-miss' | 'intake';

export type ExpectedEvidence = { file: string; line: number } | { requestUrl: string };

export interface ExpectedFinding {
  status: FindingStatus;
  confidence: Confidence;
  evidence: ExpectedEvidence[];
}

export interface Fixture {
  ruleId: string;
  /** Folder name, e.g. "fires-vite-css-import.fixed". */
  name: string;
  dir: string;
  category: FixtureCategory;
  /** A fixed twin: the firing fixture after its fix guidance was followed by hand. */
  fixed: boolean;
  mode: 'static' | 'runtime';
  description: string;
  expect: ExpectedFinding[];
}

const CATEGORIES: FixtureCategory[] = ['fires', 'pass', 'near-miss', 'intake'];

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

/** Reduces real findings to the shape written in expect.json, in a stable order. */
export function toComparable(findings: Finding[]): ExpectedFinding[] {
  const shaped = findings.map((f) => ({
    status: f.status,
    confidence: f.confidence,
    evidence: f.evidence.map((e): ExpectedEvidence => {
      if (e.kind === 'static') return { file: e.file, line: e.startLine };
      if (e.kind === 'runtime') return { requestUrl: e.requestUrl };
      throw new Error('absence evidence is not used by any fixture yet');
    }),
  }));
  return sortComparable(shaped);
}

export function sortComparable(list: ExpectedFinding[]): ExpectedFinding[] {
  return [...list].sort((a, b) => JSON.stringify(a.evidence).localeCompare(JSON.stringify(b.evidence)));
}
