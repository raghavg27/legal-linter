import { describe, expect, it } from 'vitest';
import { defineRule } from './define-rule.ts';
import { evaluateCapture } from './engine.ts';
import { findingId } from './finding-id.ts';
import { contentHash } from './judgments.ts';
import { pickFollowLinks } from './runtime/crawler.ts';
import type { PageCapture, RawFinding, SiteCapture } from './types.ts';

const legalYaml = `ruleId: LL-99
name: Test rule
law: Test law
trap: t
appliesWhen: a
doesNotApplyIf: d
exposure: e
exposureKind: consequence
detectionConfidence: High
sources: []
lastReviewed: null
reviewStatus: draft`;
const fixYaml = `ruleId: LL-99
fixType: full
goal: g
steps: [{ title: t, why: w, instructions: i }]
doneWhen: [re-scan passes]
ownerSteps: []`;

const material = [{ label: 'Template', file: 'emails/x.tsx', content: 'Big sale this week' }];
const judged: RawFinding = {
  key: 'emails/x.tsx',
  confidence: 'medium',
  evidence: [{ kind: 'absence', looked: ['x'], observed: 'no footer' }],
  explanation: 'One. Two.',
  judgment: {
    question: 'Marketing or transactional?',
    options: [
      { value: 'marketing', outcome: 'open', meaning: 'promo' },
      { value: 'transactional', outcome: 'drop', meaning: 'receipt' },
    ],
    material,
  },
};

function ruleReturning(raw: RawFinding, appliesValue: 'yes' | 'unknown' = 'yes') {
  return defineRule({
    meta: { id: 'LL-99', name: 'Test rule', law: 'Test law', regions: ['US'], phase: 1, fixType: 'full', detection: ['runtime'], topics: [] },
    legalYaml,
    fixYaml,
    applies: () => ({ value: appliesValue, reason: 'r', missing: appliesValue === 'unknown' ? ['countries'] : undefined }),
    detectRuntime: () => [raw],
  });
}

const capture: SiteCapture = { startUrl: 'http://127.0.0.1/', userAgent: 'ua', pages: [] };
const id = findingId('LL-99', 'emails/x.tsx');

describe('judgments', () => {
  it('asks the question when no answer is stored, with a content hash', async () => {
    const r = await evaluateCapture(capture, { rules: [ruleReturning(judged)], toolVersion: 't', intake: {}, judgments: {} });
    expect(r.findings[0]).toMatchObject({ status: 'needs_judgment', judgment: { contentHash: contentHash(material) } });
    expect(r.summary.needsJudgment).toBe(1);
  });

  it('turns a stored "open" answer into a high-confidence open finding', async () => {
    const judgments = { [id]: { answer: 'marketing', contentHash: contentHash(material), answeredAt: '2026-10-06T00:00:00Z' } };
    const r = await evaluateCapture(capture, { rules: [ruleReturning(judged)], toolVersion: 't', intake: {}, judgments });
    expect(r.findings[0]).toMatchObject({ status: 'open', confidence: 'high' });
  });

  it('drops the finding on a stored "drop" answer', async () => {
    const judgments = { [id]: { answer: 'transactional', contentHash: contentHash(material), answeredAt: 'x' } };
    const r = await evaluateCapture(capture, { rules: [ruleReturning(judged)], toolVersion: 't', intake: {}, judgments });
    expect(r.findings).toEqual([]);
  });

  it('asks again when the material changed since the answer', async () => {
    const judgments = { [id]: { answer: 'transactional', contentHash: 'stale', answeredAt: 'x' } };
    const r = await evaluateCapture(capture, { rules: [ruleReturning(judged)], toolVersion: 't', intake: {}, judgments });
    expect(r.findings[0]?.status).toBe('needs_judgment');
  });

  it('asks for intake before judgment', async () => {
    const r = await evaluateCapture(capture, { rules: [ruleReturning(judged, 'unknown')], toolVersion: 't', intake: null, judgments: {} });
    expect(r.findings[0]).toMatchObject({ status: 'needs_intake', questions: [{ key: 'countries' }] });
  });

  it('honours per-finding intake needs', async () => {
    const raw: RawFinding = { ...judged, judgment: undefined, needsIntake: ['dmcaAgentRegistered'] };
    const r = await evaluateCapture(capture, { rules: [ruleReturning(raw)], toolVersion: 't', intake: {}, judgments: {} });
    expect(r.findings[0]).toMatchObject({ status: 'needs_intake', questions: [{ key: 'dmcaAgentRegistered' }] });
  });
});

describe('pickFollowLinks', () => {
  const page = (links: [string, string][]): PageCapture => ({
    url: 'https://a.test/',
    finalUrl: 'https://a.test/',
    status: 200,
    requests: [],
    cookies: [],
    text: '',
    html: '',
    links: links.map(([href, text]) => ({ href, text })),
  });

  it('follows same-origin pricing and legal links, pricing first, capped', () => {
    const start = page([
      ['https://a.test/blog', 'Blog'],
      ['https://a.test/legal/dmca', 'Copyright'],
      ['https://other.test/pricing', 'Pricing'],
      ['https://a.test/pricing#top', 'Pricing'],
      ['https://a.test/pricing', 'See plans'],
      ['https://a.test/terms', 'Terms'],
    ]);
    expect(pickFollowLinks(start, 2)).toEqual(['https://a.test/pricing', 'https://a.test/legal/dmca']);
    expect(pickFollowLinks(start, 0)).toEqual([]);
  });
});
