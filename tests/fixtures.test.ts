import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureSite, evaluateCapture, loadConfig, scanRepo, type Finding, type ScanReport } from '@legal-lint/core';
import { rules } from '@legal-lint/rules';
import { loadFixtures, sortComparable, toComparable, type Fixture } from './helpers/fixtures.ts';
import { serveStatic } from './helpers/static-server.ts';
import { bannedWording, sentenceCount } from './helpers/wording.ts';

const VERSION = '0.0.0-test';
const fixtures = loadFixtures();

function checkFindingShape(f: Finding): void {
  expect(sentenceCount(f.explanation), `explanation must be two sentences: ${f.explanation}`).toBe(2);
  expect(bannedWording(f.explanation), f.explanation).toBeNull();
  expect(f.id).toMatch(new RegExp(`^${f.ruleId}-[0-9a-f]{10}$`));
  expect(f.doesNotApplyIf.length).toBeGreaterThan(0);
  expect(f.exposure.text.length).toBeGreaterThan(0);
  expect(f.evidence.length).toBeGreaterThan(0);
  if (f.status === 'needs_intake') expect(f.questions.length).toBeGreaterThan(0);
}

function assertFixture(fixture: Fixture, report: ScanReport): void {
  const forRule = report.findings.filter((f) => f.ruleId === fixture.ruleId);
  for (const f of forRule) checkFindingShape(f);
  expect(report.rulesRun.find((r) => r.id === fixture.ruleId)?.error).toBeUndefined();
  expect(toComparable(forRule)).toEqual(sortComparable(fixture.expect));
  expect(report.disclaimer).toMatch(/not legal advice/);
}

describe('static fixtures', () => {
  for (const fixture of fixtures.filter((f) => f.mode === 'static')) {
    it(`${fixture.ruleId} ${fixture.name}: ${fixture.description}`, async () => {
      const report = await scanRepo(fixture.dir, { rules, toolVersion: VERSION, only: [fixture.ruleId] });
      assertFixture(fixture, report);
    });
  }
});

describe('runtime fixtures', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  for (const fixture of fixtures.filter((f) => f.mode === 'runtime')) {
    it(`${fixture.ruleId} ${fixture.name}: ${fixture.description}`, async () => {
      const server = await serveStatic(path.join(fixture.dir, 'site'));
      try {
        const capture = await captureSite(server.url, { browser, offline: true, toolVersion: VERSION, timeoutMs: 10_000 });
        expect(capture.pages[0]?.error).toBeUndefined();
        const intake = (await loadConfig(fixture.dir))?.intake ?? null;
        const report = await evaluateCapture(capture, { rules, toolVersion: VERSION, intake, only: [fixture.ruleId] });
        assertFixture(fixture, report);
      } finally {
        await server.close();
      }
    });
  }
});

describe('finding ids', () => {
  it('are stable across scans and ignore line numbers', async () => {
    const dir = fixtures.find((f) => f.name === 'fires-vite-css-import')!.dir;
    const a = await scanRepo(dir, { rules, toolVersion: VERSION });
    const b = await scanRepo(dir, { rules, toolVersion: VERSION });
    expect(a.findings.map((f) => f.id)).toEqual(b.findings.map((f) => f.id));
  });
});
