import { access, appendFile, cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, InMemoryTransport, type CallToolResult } from '@modelcontextprotocol/client';
import { chromium, type Browser } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { scanRepo } from '@legal-lint/core';
import { rules } from '@legal-lint/rules';
import { startServer } from '../packages/cli/src/mcp/serve.ts';
import type { AgentFinding } from '../packages/cli/src/mcp/output.ts';
import { MATERIAL_LIMIT, type ServerOptions } from '../packages/cli/src/mcp/server.ts';
import { FIXTURES_DIR } from './helpers/fixtures.ts';
import { serveStatic } from './helpers/static-server.ts';
import { bannedWording } from './helpers/wording.ts';

const VERSION = '0.0.0-test';
const fixture = (rule: string, name: string) => path.join(FIXTURES_DIR, rule, name);

/** A copy of a fixture in a temp dir, since the server writes the HTML report and config answers into the project. */
async function project(rule: string, name: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `legal-lint-mcp-${rule}-`));
  await cp(fixture(rule, name), dir, { recursive: true });
  return dir;
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

/** Connects a real SDK client to the server through the same stdio entry point production uses. */
async function connect(opts: Partial<ServerOptions> = {}): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const handle = startServer({ version: VERSION, ...opts }, serverSide);
  const client = new Client({ name: 'legal-lint-test', version: '1.0.0' });
  await client.connect(clientSide);
  closers.push(async () => {
    await client.close();
    await handle.close();
  });
  return client;
}

async function call<T = Record<string, unknown>>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
  if (result.isError) throw new Error(`${name} failed: ${text}`);
  // Some clients only show the model the text block, so it must carry the same data.
  expect(JSON.parse(text)).toEqual(result.structuredContent);
  return result.structuredContent as T;
}

async function callError(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  expect(result.isError, `${name} should fail`).toBe(true);
  return result.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
}

interface ScanResult {
  summary: { open: number; needsJudgment: number; needsIntake: number };
  findings: AgentFinding[];
  htmlReport: string;
  next: string[];
  disclaimer: string;
}

const TOOLS = ['answer_intake', 'answer_judgment', 'explain_rule', 'get_fix_guidance', 'preflight_check', 'scan_repo', 'scan_url'];

describe('MCP server: tool list', () => {
  it('lists the seven tools, each with a description, input and output schema and annotations', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
    for (const t of tools) {
      expect(t.description!.length, t.name).toBeGreaterThan(80);
      expect(t.inputSchema.type).toBe('object');
      expect(t.outputSchema?.type, t.name).toBe('object');
      expect(t.annotations?.readOnlyHint, t.name).toBeTypeOf('boolean');
    }
    expect(client.getServerVersion()).toMatchObject({ name: 'legal-lint', version: VERSION });
  });

  it('tells agents when to call the pre-flight check', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const preflight = tools.find((t) => t.name === 'preflight_check')!.description!;
    for (const area of ['payments', 'analytics', 'email', 'SMS', 'uploads', 'auth', 'fonts']) expect(preflight).toContain(area);
    expect(preflight).toMatch(/^Call this BEFORE/);
    expect(client.getInstructions()).toContain('preflight_check');
  });

  it('uses no wording that concludes the user is breaking the law', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    for (const t of tools) expect(bannedWording(t.description!), t.name).toBeNull();
    // The instructions say a fix is no promise of meeting the law; check everything else.
    expect(bannedWording(client.getInstructions()!)).toBeNull();
  });
});

describe('MCP server: preflight_check', () => {
  it('returns the matching rule, what must be true, and asks the intake question when unanswered', async () => {
    const client = await connect();
    const dir = await mkdtemp(path.join(tmpdir(), 'legal-lint-mcp-'));
    const out = await call<{ rules: Record<string, any>[]; intake: string; next: string[] }>(client, 'preflight_check', {
      building: 'Stripe subscriptions',
      path: dir,
    });
    expect(out.intake).toBe('missing');
    expect(out.rules.map((r) => r.ruleId)).toEqual(['LL-04']);
    const [r] = out.rules;
    expect(r!.matchedOn).toContain('stripe subscriptions');
    expect(r!.appliesHere).toEqual({
      value: 'unknown',
      reason: expect.any(String),
      questions: [
        { key: 'sellsSubscriptions', question: 'Does the product sell subscriptions?' },
        { key: 'countries', question: 'Which countries does the product serve? (ISO codes, e.g. US, DE, IN)' },
      ],
    });
    expect(r!.mustBeTrue).toEqual(rules.find((x) => x.meta.id === 'LL-04')!.fix.doneWhen);
    expect(r!.exposure.kind).toBe('consequence');
    expect(out.next.join(' ')).toMatch(/answer_intake/);
  });

  it('reads the intake answers from the project', async () => {
    const client = await connect();
    const dir = await mkdtemp(path.join(tmpdir(), 'legal-lint-mcp-'));
    await writeFile(path.join(dir, 'legal-lint.config.json'), JSON.stringify({ intake: { countries: ['US'], sellsSubscriptions: true } }));
    const out = await call<{ rules: Record<string, any>[]; intake: string }>(client, 'preflight_check', { building: 'Stripe subscriptions', path: dir });
    expect(out.intake).toBe('loaded');
    expect(out.rules[0]!.appliesHere).toMatchObject({ value: 'yes', questions: [] });
  });

  it('says plainly that no match is not a clearance', async () => {
    const client = await connect();
    const out = await call<{ rules: unknown[]; coverage: string; next: string[] }>(client, 'preflight_check', {
      building: 'dark mode toggle',
      path: FIXTURES_DIR,
    });
    expect(out.rules).toEqual([]);
    expect(out.coverage).toContain('LL-05');
    expect(out.next[0]).toMatch(/None of the phase 1 rules matched/);
  });
});

describe('MCP server: scan_repo', () => {
  it('returns every finding exactly as the engine reports it, and writes the HTML report', async () => {
    const dir = await project('LL-01', 'fires-next-pages-document');
    const client = await connect();
    const out = await call<ScanResult>(client, 'scan_repo', { path: dir });
    const engine = await scanRepo(dir, { rules, toolVersion: VERSION });

    expect(out.summary).toEqual({ open: 1, needsJudgment: 0, needsIntake: 0 });
    // Not compacted: every finding, every location, full snippets.
    expect(out.findings).toEqual(engine.findings);
    expect(out.findings[0]!.evidence).toHaveLength(3);
    expect(out.htmlReport).toBe(path.join(dir, '.legal-lint', 'report.html'));
    expect(await readFile(out.htmlReport, 'utf8')).toContain(out.findings[0]!.id);
    expect(out.next.join(' ')).toMatch(/get_fix_guidance.*scan_repo again/);
    expect(out.next.at(-1)).toContain(out.htmlReport);
    expect(out.disclaimer).toMatch(/not legal advice/);
  });

  it('only runs the requested rules', async () => {
    const dir = await project('LL-01', 'fires-next-pages-document');
    const client = await connect();
    const out = await call<ScanResult & { rulesRun: { id: string }[] }>(client, 'scan_repo', { path: dir, rules: ['LL-02'] });
    expect(out.rulesRun.map((r) => r.id)).toEqual(['LL-02']);
    expect(out.findings).toEqual([]);
    expect(out.next[0]).toMatch(/No findings/);
  });

  it('cuts long judgment material and says so, leaving the rest of the finding whole', async () => {
    const dir = await project('LL-02', 'judgment-welcome-unanswered');
    await appendFile(path.join(dir, 'emails', 'welcome.tsx'), `\n// ${'x'.repeat(MATERIAL_LIMIT + 500)}\n`);
    const client = await connect();
    const out = await call<ScanResult>(client, 'scan_repo', { path: dir });
    const f = out.findings.find((x) => x.status === 'needs_judgment')!;
    if (f.status !== 'needs_judgment') throw new Error('expected a judgment finding');
    const long = f.judgment.material.find((m) => m.truncated)!;
    expect(long.content).toHaveLength(MATERIAL_LIMIT);
    expect(out.next.join(' ')).toMatch(/answer_judgment/);
  });

  it('asks the agent to ask the user, not guess, for intake questions', async () => {
    const dir = await project('LL-01', 'intake-missing');
    const out = await call<ScanResult>(await connect(), 'scan_repo', { path: dir });
    expect(out.summary.needsIntake).toBe(1);
    expect(out.next.join(' ')).toMatch(/ask the user the question \(do not guess\).*answer_intake/);
  });

  it('fails clearly for a path that is not a directory', async () => {
    const message = await callError(await connect(), 'scan_repo', { path: path.join(FIXTURES_DIR, 'nope') });
    expect(message).toMatch(/Not a directory: .*nope\. Pass the project root as an absolute path\./);
  });
});

describe('MCP server: get_fix_guidance', () => {
  it('picks the variants for the project framework and says to re-scan for the finding', async () => {
    const dir = await project('LL-01', 'fires-next-pages-document');
    const client = await connect();
    const { findings } = await call<ScanResult>(client, 'scan_repo', { path: dir });
    const id = findings[0]!.id;
    const out = await call<Record<string, any>>(client, 'get_fix_guidance', { findingId: id, path: dir });
    expect(out.ruleId).toBe('LL-01');
    expect(out.findingId).toBe(id);
    expect(out.frameworks).toEqual(['next-pages']);
    const withVariants = out.steps.filter((s: any) => Object.keys(s.forFramework).length > 0);
    expect(withVariants.length).toBeGreaterThan(0);
    for (const s of out.steps) expect(Object.keys(s.forFramework).every((k) => k === 'next-pages')).toBe(true);
    for (const s of out.steps) expect(s.why.length).toBeGreaterThan(0);
    expect(out.next[0]).toContain(`call scan_repo and check that finding ${id} is reported`);
    expect(out.next.join(' ')).toMatch(/scan_url/);
  });

  it('gives every variant when no framework is found, and passes on owner-only steps', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'legal-lint-mcp-'));
    const out = await call<Record<string, any>>(await connect(), 'get_fix_guidance', { ruleId: 'LL-05', path: dir });
    expect(out.frameworks).toEqual([]);
    const rule = rules.find((r) => r.meta.id === 'LL-05')!;
    expect(out.steps.map((s: any) => s.forFramework)).toEqual(rule.fix.steps.map((s) => s.variants ?? {}));
    expect(out.ownerSteps.length).toBeGreaterThan(0);
    expect(out.next.join(' ')).toMatch(/ownerSteps; only they can do them/);
  });

  it('rejects a finding id that does not match the rule id', async () => {
    const message = await callError(await connect(), 'get_fix_guidance', { findingId: 'LL-01-0123456789', ruleId: 'LL-02', path: FIXTURES_DIR });
    expect(message).toMatch(/belongs to LL-01, not LL-02/);
  });
});

describe('MCP server: answer_judgment', () => {
  async function judgmentFinding(client: Client, dir: string) {
    const { findings } = await call<ScanResult>(client, 'scan_repo', { path: dir });
    const f = findings.find((x) => x.status === 'needs_judgment');
    if (f?.status !== 'needs_judgment') throw new Error('expected a judgment finding');
    return { id: f.id, hash: f.judgment.contentHash };
  }

  it('"marketing" turns the finding into an open one at high confidence and stores who answered and why', async () => {
    const dir = await project('LL-02', 'judgment-welcome-unanswered');
    const client = await connect();
    const { id, hash } = await judgmentFinding(client, dir);
    const out = await call<Record<string, any>>(client, 'answer_judgment', {
      findingId: id,
      answer: 'marketing',
      contentHash: hash,
      reason: 'The body promotes "our current offers".',
      path: dir,
    });
    expect(out).toMatchObject({ findingId: id, outcome: 'open', finding: { id, status: 'open', confidence: 'high' } });
    expect(out.next[0]).toMatch(/get_fix_guidance/);

    const config = JSON.parse(await readFile(path.join(dir, 'legal-lint.config.json'), 'utf8'));
    expect(config.intake).toEqual({ countries: ['US'], sendsMarketingEmail: true });
    expect(config.judgments[id]).toMatchObject({ answer: 'marketing', contentHash: hash, answeredBy: 'agent', reason: 'The body promotes "our current offers".' });

    const again = await call<ScanResult>(client, 'scan_repo', { path: dir });
    expect(again.findings.find((f) => f.id === id)).toMatchObject({ status: 'open', confidence: 'high' });
  });

  it('"transactional" drops the finding, and a later scan stays quiet', async () => {
    const dir = await project('LL-02', 'judgment-welcome-unanswered');
    const client = await connect();
    const { id, hash } = await judgmentFinding(client, dir);
    const out = await call<Record<string, any>>(client, 'answer_judgment', {
      findingId: id,
      answer: 'transactional',
      contentHash: hash,
      reason: 'Sent once after signup.',
      path: dir,
    });
    expect(out.outcome).toBe('dropped');
    expect(out.finding).toBeUndefined();
    expect((await call<ScanResult>(client, 'scan_repo', { path: dir })).findings.filter((f) => f.ruleId === 'LL-02')).toEqual([]);
  });

  it('refuses a stale hash, an unknown option, an unknown finding and a finding that needs intake first', async () => {
    const dir = await project('LL-02', 'judgment-welcome-unanswered');
    const client = await connect();
    const { id, hash } = await judgmentFinding(client, dir);
    const base = { findingId: id, answer: 'marketing', contentHash: hash, reason: 'promo copy', path: dir };

    expect(await callError(client, 'answer_judgment', { ...base, contentHash: '0000000000000000' })).toMatch(/changed since it was read/);
    expect(await callError(client, 'answer_judgment', { ...base, answer: 'newsletter' })).toMatch(/Choose one of: marketing, transactional/);
    expect(await callError(client, 'answer_judgment', { ...base, findingId: 'LL-02-0000000000' })).toMatch(/No finding LL-02-0000000000/);

    // The template changed after it was read: the stored hash no longer applies.
    await appendFile(path.join(dir, 'emails', 'welcome.tsx'), '\n// edited\n');
    expect(await callError(client, 'answer_judgment', base)).toMatch(/changed since it was read/);
    await access(path.join(dir, 'legal-lint.config.json'));
    expect(JSON.parse(await readFile(path.join(dir, 'legal-lint.config.json'), 'utf8')).judgments).toBeUndefined();

    const intakeDir = await project('LL-01', 'intake-missing');
    const { findings } = await call<ScanResult>(client, 'scan_repo', { path: intakeDir });
    const message = await callError(client, 'answer_judgment', { ...base, findingId: findings[0]!.id, path: intakeDir });
    expect(message).toMatch(/needs intake answers first: euUkVisitors/);
  });
});

describe('MCP server: answer_intake', () => {
  it('records the user’s answer, keeps other config, and the next scan uses it', async () => {
    const dir = await project('LL-01', 'intake-missing');
    await writeFile(
      path.join(dir, 'legal-lint.config.json'),
      JSON.stringify({ intake: { sendsMarketingEmail: false }, judgments: { 'LL-02-abc': { answer: 'marketing', contentHash: 'h', answeredAt: 't' } } }),
    );
    const client = await connect();
    expect((await call<ScanResult>(client, 'scan_repo', { path: dir })).summary.needsIntake).toBe(1);

    const out = await call<Record<string, any>>(client, 'answer_intake', { answers: { euUkVisitors: true }, path: dir });
    expect(out.intake).toEqual({ sendsMarketingEmail: false, euUkVisitors: true });
    expect(out.rules.find((r: any) => r.ruleId === 'LL-01').appliesHere).toMatchObject({ value: 'yes' });
    expect(out.next[0]).toMatch(/scan_repo/);

    const config = JSON.parse(await readFile(path.join(dir, 'legal-lint.config.json'), 'utf8'));
    expect(config.judgments['LL-02-abc'].answer).toBe('marketing');
    expect((await call<ScanResult>(client, 'scan_repo', { path: dir })).summary).toEqual({ open: 1, needsJudgment: 0, needsIntake: 0 });
  });

  it('describes each question in the input schema and tells agents never to guess', async () => {
    const { tools } = await (await connect()).listTools();
    const tool = tools.find((t) => t.name === 'answer_intake')!;
    expect(tool.description).toMatch(/Never guess/);
    const answers = (tool.inputSchema.properties as Record<string, any>).answers;
    expect(answers.properties.euUkVisitors.description).toBe('Are visitors from the EU, EEA or UK expected?');
  });

  it('rejects empty, unknown and badly typed answers without touching the file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'legal-lint-mcp-'));
    const client = await connect();
    expect(await callError(client, 'answer_intake', { answers: {}, path: dir })).toMatch(/No answers given/);
    expect(await callError(client, 'answer_intake', { answers: { euUkVisitors: 'yes' }, path: dir })).toMatch(/euUkVisitors/);
    expect(await callError(client, 'answer_intake', { answers: { favouriteColour: 'blue' }, path: dir })).toMatch(/favouriteColour/);
    await expect(access(path.join(dir, 'legal-lint.config.json'))).rejects.toThrow();
  });
});

describe('MCP server: explain_rule', () => {
  it('explains the rule with labelled exposure and whether it applies here', async () => {
    const out = await call<Record<string, any>>(await connect(), 'explain_rule', { ruleId: 'LL-01', path: fixture('LL-01', 'intake-missing') });
    const rule = rules.find((r) => r.meta.id === 'LL-01')!;
    expect(out).toMatchObject({
      ruleId: 'LL-01',
      law: rule.meta.law,
      trap: rule.legal.trap,
      doesNotApplyIf: rule.legal.doesNotApplyIf,
      exposure: { text: rule.legal.exposure, kind: 'named_case' },
      appliesHere: { value: 'unknown', questions: [{ key: 'euUkVisitors' }] },
      reviewStatus: 'draft',
    });
    expect(out.disclaimer).toMatch(/not legal advice/);
  });

  it('rejects an unknown rule id', async () => {
    expect(await callError(await connect(), 'explain_rule', { ruleId: 'LL-99' })).toMatch(/LL-99|ruleId/);
  });
});

describe('MCP server: scan_url', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('scans a local preview with the project’s answers and writes the report into the project', async () => {
    const server = await serveStatic(path.join(fixture('LL-01', 'fires-runtime-link-tag'), 'site'));
    closers.push(() => server.close());
    const dir = await mkdtemp(path.join(tmpdir(), 'legal-lint-mcp-'));
    await cp(path.join(fixture('LL-01', 'fires-runtime-link-tag'), 'legal-lint.config.json'), path.join(dir, 'legal-lint.config.json'));

    const client = await connect({ capture: { browser, offline: true, timeoutMs: 10_000 } });
    const out = await call<ScanResult & { target: { kind: string } }>(client, 'scan_url', { url: server.url, path: dir, rules: ['LL-01'] });
    expect(out.target.kind).toBe('url');
    expect(out.summary.open).toBe(1);
    expect(out.findings[0]!.evidence[0]).toMatchObject({ kind: 'runtime' });
    expect(out.next[0]).toMatch(/call scan_url again/);
    await access(out.htmlReport);
  });

  it('rejects non-http URLs before launching anything', async () => {
    expect(await callError(await connect(), 'scan_url', { url: 'file:///etc/passwd' })).toMatch(/Only http and https/);
    expect(await callError(await connect(), 'scan_url', { url: 'not a url' })).toMatch(/Not a valid URL/);
  });
});
