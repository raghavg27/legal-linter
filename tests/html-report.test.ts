import { cp, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISCLAIMER, formatHtml, scanRepo, type Finding, type ScanReport } from '@legal-lint/core';
import { rules } from '@legal-lint/rules';
import { EXIT, run } from '../packages/cli/src/program.ts';
import { FIXTURES_DIR } from './helpers/fixtures.ts';
import { bannedWording } from './helpers/wording.ts';

const VERSION = '0.0.0-test';
const fixture = (rule: string, name: string) => path.join(FIXTURES_DIR, rule, name);
const scan = (dir: string) => scanRepo(dir, { rules, toolVersion: VERSION });

/** One report holding an open finding, a judgment question and an intake question. */
async function mixedReport(): Promise<ScanReport> {
  const parts = await Promise.all([
    scan(fixture('LL-01', 'fires-next-pages-document')),
    scan(fixture('LL-02', 'judgment-welcome-unanswered')),
    scan(fixture('LL-01', 'intake-missing')),
  ]);
  const findings = parts.flatMap((p) => p.findings);
  return {
    ...parts[0]!,
    findings,
    summary: {
      open: findings.filter((f) => f.status === 'open').length,
      needsJudgment: findings.filter((f) => f.status === 'needs_judgment').length,
      needsIntake: findings.filter((f) => f.status === 'needs_intake').length,
    },
  };
}

function textOf(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

describe('HTML report', () => {
  it('leads with the counts and lists every finding with every location', async () => {
    const report = await mixedReport();
    expect(report.summary).toEqual({ open: 1, needsJudgment: 1, needsIntake: 1 });
    const html = formatHtml(report);

    expect(textOf(html)).toContain('1 finding to fix, 1 decision to make and 1 question for you.');
    for (const title of ['To fix', 'Needs a decision', 'Needs an answer from you', 'By rule']) expect(html).toContain(`<h2>${title}</h2>`);
    for (const f of report.findings) {
      expect(html).toContain(`id="${f.id}"`);
      for (const e of f.evidence) {
        if (e.kind === 'static') expect(html).toContain(`${e.file}:${e.startLine}`);
      }
    }
    const judged = report.findings.find((f) => f.status === 'needs_judgment')!;
    if (judged.status === 'needs_judgment') expect(textOf(html)).toContain(judged.judgment.question);
    expect(html).toContain('intake.euUkVisitors');
  });

  it('labels exposure and shows when a rule does not apply', async () => {
    const report = await scan(fixture('LL-01', 'fires-next-pages-document'));
    const html = formatHtml(report);
    const f = report.findings[0]!;
    expect(html).toContain('Exposure (named case)');
    expect(textOf(html)).toContain(f.doesNotApplyIf);
  });

  it('shows every rule that ran, including clean and not applicable ones', async () => {
    const report = await scan(fixture('LL-01', 'intake-not-eu'));
    const text = textOf(formatHtml(report));
    for (const r of report.rulesRun) expect(text).toContain(`${r.id} ${r.name}`);
    expect(text).toMatch(/LL-01 .* Not applicable\. Intake: no EU\/EEA\/UK visitors are expected\./);
    expect(text).toContain('Nothing found');
  });

  it('says so plainly when there is nothing to fix, and ends with the disclaimer', async () => {
    const report = await scan(fixture('LL-01', 'pass-next-font'));
    const html = formatHtml(report);
    expect(html).toContain('<h1>Nothing to fix right now.</h1>');
    expect(textOf(html).trim().endsWith(DISCLAIMER)).toBe(true);
  });

  it('is self-contained: no scripts, stylesheets, fonts or images from anywhere', async () => {
    const html = formatHtml(await mixedReport());
    expect(html).not.toMatch(/<script|<link|<img|<iframe|\ssrc=|@import|url\(|@font-face/i);
  });

  it('escapes everything taken from the scanned repo', () => {
    const evil = '<script>alert("x")</script>';
    const finding: Finding = {
      id: 'LL-01-0000000000',
      ruleId: 'LL-01',
      ruleName: 'Rule',
      status: 'open',
      confidence: 'high',
      evidence: [{ kind: 'static', file: `a${evil}.html`, startLine: 1, endLine: 1, snippet: evil, observed: evil }],
      explanation: evil,
      doesNotApplyIf: evil,
      exposure: { text: evil, kind: 'named_case' },
      fixType: 'full',
    };
    const report: ScanReport = {
      tool: { name: 'legal-lint', version: VERSION },
      target: { kind: 'repo', root: `/tmp/${evil}`, filesScanned: 1 },
      intake: 'loaded',
      rulesRun: [{ id: 'LL-01', name: evil, applies: 'yes', reason: evil }],
      findings: [finding],
      summary: { open: 1, needsJudgment: 0, needsIntake: 0 },
      disclaimer: DISCLAIMER,
    };
    const html = formatHtml(report);
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });

  it('uses no wording that concludes the owner is breaking the law', async () => {
    const report = await mixedReport();
    let text = textOf(formatHtml(report));
    // Exposure lines are copied from the rulebook word for word and reviewed separately (LEGAL_REVIEW.md).
    for (const f of report.findings) text = text.replaceAll(f.exposure.text, '');
    expect(bannedWording(text)).toBeNull();
  });
});

describe('legal-lint scan --html', () => {
  async function cli(...argv: string[]) {
    let stdout = '';
    let stderr = '';
    const code = await run(argv, {
      stdout: { write: (s: string) => (stdout += s), isTTY: false },
      stderr: { write: (s: string) => (stderr += s) },
    });
    return { code, stdout, stderr };
  }

  it('writes the report into a self-ignoring .legal-lint folder, keeps --json parseable, and is not scanned next time', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'legal-lint-html-'));
    await cp(fixture('LL-01', 'fires-next-pages-document'), dir, { recursive: true });

    const first = await cli('scan', dir, '--json', '--html');
    expect(first.code).toBe(EXIT.findings);
    const report = JSON.parse(first.stdout) as ScanReport;
    const file = path.join(dir, '.legal-lint', 'report.html');
    expect(first.stderr).toContain(`HTML report: ${file}`);
    expect(await readFile(file, 'utf8')).toContain(`id="${report.findings[0]!.id}"`);
    expect(await readFile(path.join(dir, '.legal-lint', '.gitignore'), 'utf8')).toBe('*\n');

    // The report quotes the font URL; a second scan must not report the report.
    const second = JSON.parse((await cli('scan', dir, '--json')).stdout) as ScanReport;
    expect(second.findings.map((f) => f.id)).toEqual(report.findings.map((f) => f.id));
    expect(second.target.kind === 'repo' && second.target.filesScanned).toBe(report.target.kind === 'repo' && report.target.filesScanned);
  });

  it('writes to a chosen file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'legal-lint-html-'));
    const file = path.join(dir, 'out', 'legal.html');
    const { code } = await cli('scan', fixture('LL-01', 'pass-next-font'), '--html', file);
    expect(code).toBe(EXIT.clean);
    expect(await readFile(file, 'utf8')).toContain('Nothing to fix right now.');
  });
});
