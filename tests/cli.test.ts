import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { ScanReport } from '@legal-lint/core';
import { EXIT, run } from '../packages/cli/src/program.ts';
import { FIXTURES_DIR } from './helpers/fixtures.ts';

async function cli(...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, {
    stdout: { write: (s: string) => (stdout += s), isTTY: false },
    stderr: { write: (s: string) => (stderr += s) },
  });
  return { code, stdout, stderr };
}

const fixture = (name: string) => path.join(FIXTURES_DIR, 'LL-01', name);

describe('legal-lint scan', () => {
  it('exits 1 with open findings and prints valid JSON with --json', async () => {
    const { code, stdout } = await cli('scan', fixture('fires-vite-css-import'), '--json');
    expect(code).toBe(EXIT.findings);
    const report = JSON.parse(stdout) as ScanReport;
    expect(report.tool.name).toBe('legal-lint');
    expect(report.target.kind).toBe('repo');
    expect(report.summary).toEqual({ open: 1, needsJudgment: 0, needsIntake: 0 });
    const [finding] = report.findings;
    expect(finding).toMatchObject({ ruleId: 'LL-01', status: 'open', confidence: 'high', fixType: 'full' });
    expect(finding!.evidence[0]).toMatchObject({ kind: 'static', file: 'src/index.css', startLine: 1, endLine: 1 });
    expect(finding!.exposure.kind).toBe('named_case');
  });

  it('exits 0 on a clean repo and ends with the disclaimer', async () => {
    const { code, stdout } = await cli('scan', fixture('pass-next-font'));
    expect(code).toBe(EXIT.clean);
    expect(stdout).toContain('No findings.');
    expect(stdout.trim().split('\n').at(-1)).toMatch(/not legal advice/);
  });

  it('asks the intake question instead of firing when there is no config', async () => {
    const { code, stdout } = await cli('scan', fixture('intake-missing'));
    expect(code).toBe(EXIT.clean);
    expect(stdout).toContain('needs intake answer');
    expect(stdout).toContain('intake.euUkVisitors');
  });

  it('never prints "violating" or "non-compliant"', async () => {
    const { stdout } = await cli('scan', fixture('fires-html-font-face'));
    expect(stdout).not.toMatch(/violat|non-?compliant/i);
  });

  it('exits 2 for a missing path, an unknown rule and a broken config', async () => {
    expect((await cli('scan', path.join(FIXTURES_DIR, 'does-not-exist'))).stderr).toMatch(/Not a directory/);
    const unknown = await cli('scan', fixture('pass-next-font'), '--rule', 'LL-99');
    expect(unknown.code).toBe(EXIT.error);
    expect(unknown.stderr).toMatch(/Unknown rule id: LL-99/);

    const dir = await mkdtemp(path.join(tmpdir(), 'legal-lint-'));
    await writeFile(path.join(dir, 'legal-lint.config.json'), '{ "intake": { "euUkVisitors": "yes" } }');
    const broken = await cli('scan', dir);
    expect(broken.code).toBe(EXIT.error);
    expect(broken.stderr).toMatch(/intake\.euUkVisitors/);
  });
});

describe('legal-lint scan-url', () => {
  it('rejects non-http URLs before launching a browser', async () => {
    const { code, stderr } = await cli('scan-url', 'file:///etc/passwd');
    expect(code).toBe(EXIT.error);
    expect(stderr).toMatch(/Only http and https/);
  });
});

describe('legal-lint init', () => {
  async function cliWithInput(input: string, ...argv: string[]) {
    let stdout = '';
    let stderr = '';
    const code = await run(argv, {
      stdin: Readable.from([input]),
      stdout: { write: (s: string) => (stdout += s) },
      stderr: { write: (s: string) => (stderr += s) },
    });
    return { code, stdout, stderr };
  }

  it('asks every rulebook intake question, re-asks bad answers, and keeps skipped ones unknown', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'legal-lint-init-'));
    // countries, euUk (bad then good), audience, revenue, users, subs, mkt email, sms, uploads, dmca, health, video, apps
    const answers = ['us, de', 'maybe', 'y', 'general', '', '', 'y', 'n', '', 'yes', '', '', '', 'n'].join('\n');
    const { code, stdout } = await cliWithInput(answers, 'init', dir);
    expect(code).toBe(EXIT.clean);
    expect(stdout).toContain('please answer y or n');
    const config = JSON.parse(await readFile(path.join(dir, 'legal-lint.config.json'), 'utf8'));
    expect(config.intake).toEqual({
      countries: ['US', 'DE'],
      euUkVisitors: true,
      audience: 'general',
      sellsSubscriptions: true,
      sendsMarketingEmail: false,
      hostsPublicUploads: true,
      shipsMobileApps: false,
    });
  });

  it('takes --answers, refuses to overwrite without --force, and keeps stored judgments', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'legal-lint-init-'));
    const file = path.join(dir, 'legal-lint.config.json');
    await writeFile(file, JSON.stringify({ judgments: { 'LL-02-abc': { answer: 'marketing', contentHash: 'h', answeredAt: 't' } } }));
    expect((await cli('init', dir, '--answers', '{"euUkVisitors":false}')).code).toBe(EXIT.clean);

    const again = await cli('init', dir, '--answers', '{"euUkVisitors":true}');
    expect(again.code).toBe(EXIT.error);
    expect(again.stderr).toMatch(/--force/);

    expect((await cli('init', dir, '--answers', '{"euUkVisitors":true}', '--force')).code).toBe(EXIT.clean);
    const config = JSON.parse(await readFile(file, 'utf8'));
    expect(config.intake).toEqual({ euUkVisitors: true });
    expect(config.judgments['LL-02-abc'].answer).toBe('marketing');

    const bad = await cli('init', dir, '--answers', '{"euUkVisitors":"sure"}', '--force');
    expect(bad.code).toBe(EXIT.error);
    expect(bad.stderr).toMatch(/euUkVisitors/);
  });
});

describe('intake coverage', () => {
  it('init asks about every intake field the config accepts', async () => {
    const { INTAKE_SPECS } = await import('../packages/cli/src/init.ts');
    const { intakeSchema } = await import('@legal-lint/core');
    expect(INTAKE_SPECS.map((s) => s.key).sort()).toEqual(Object.keys(intakeSchema.shape).sort());
  });
});

describe('judgment output', () => {
  it('prints the question, the options and how to record an answer', async () => {
    const { code, stdout } = await cli('scan', path.join(FIXTURES_DIR, 'LL-02', 'judgment-welcome-unanswered'));
    expect(code).toBe(EXIT.clean);
    expect(stdout).toContain('needs judgment');
    expect(stdout).toContain('marketing: ');
    expect(stdout).toContain('transactional: ');
    expect(stdout).toMatch(/"LL-02-[0-9a-f]{10}": \{ "answer": "<marketing\|transactional>", "contentHash": "[0-9a-f]{16}"/);
  });
});
