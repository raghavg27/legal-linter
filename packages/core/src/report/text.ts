import type { Evidence, Finding, ScanReport } from '../types.ts';

const EXPOSURE_LABEL = {
  statutory_max: 'Exposure (statutory maximum)',
  named_case: 'Exposure (named case)',
  consequence: 'Exposure',
} as const;

const STATUS_LABEL = {
  open: 'open',
  needs_judgment: 'needs judgment',
  needs_intake: 'needs intake answer',
} as const;

type Paint = (codes: [number, number], s: string) => string;

function painter(color: boolean): Paint {
  return color ? ([on, off], s) => `\u001b[${on}m${s}\u001b[${off}m` : (_codes, s) => s;
}

const BOLD: [number, number] = [1, 22];
const DIM: [number, number] = [2, 22];
const RED: [number, number] = [31, 39];
const YELLOW: [number, number] = [33, 39];
const CYAN: [number, number] = [36, 39];

function formatEvidence(e: Evidence, paint: Paint): string[] {
  switch (e.kind) {
    case 'static':
      return [
        `  ${paint(CYAN, e.startLine === e.endLine ? `${e.file}:${e.startLine}` : `${e.file}:${e.startLine}-${e.endLine}`)}  ${e.observed}`,
        `    ${paint(DIM, e.snippet)}`,
      ];
    case 'runtime':
      return [
        `  ${paint(CYAN, e.requestUrl)}`,
        `    ${paint(DIM, `${e.observed} · ${e.resourceType} · ${e.msSinceNavigation} ms after navigation · on ${e.pageUrl}`)}`,
      ];
    case 'absence':
      return [`  ${e.observed}`, `    ${paint(DIM, `looked for: ${e.looked.join(', ')}`)}`];
  }
}

function formatFinding(f: Finding, paint: Paint): string[] {
  const marker = f.status === 'open' ? paint(RED, '●') : paint(YELLOW, '○');
  const lines = [
    `${marker} ${paint(BOLD, f.ruleId)} ${f.ruleName}  ${paint(DIM, `[${STATUS_LABEL[f.status]} · ${f.confidence} confidence]`)}`,
  ];
  for (const e of f.evidence) lines.push(...formatEvidence(e, paint));
  lines.push(`  ${f.explanation}`);
  lines.push(`  ${paint(DIM, 'Does not apply if:')} ${f.doesNotApplyIf}`);
  lines.push(`  ${paint(DIM, `${EXPOSURE_LABEL[f.exposure.kind]}:`)} ${f.exposure.text}`);
  if (f.status === 'needs_intake') {
    lines.push(`  ${paint(YELLOW, 'Answer in legal-lint.config.json to confirm whether this applies:')}`);
    for (const q of f.questions) lines.push(`    intake.${q.key}: ${q.question}`);
  }
  if (f.status === 'needs_judgment') {
    lines.push(`  ${paint(YELLOW, 'Question:')} ${f.judgment.question}`);
    for (const o of f.judgment.options) lines.push(`    ${o.value}: ${o.meaning}`);
    lines.push(
      paint(DIM, `  To answer, add to legal-lint.config.json under "judgments": "${f.id}": { "answer": "<${f.judgment.options.map((o) => o.value).join('|')}>", "contentHash": "${f.judgment.contentHash}", "answeredAt": "<ISO date>" }`),
    );
  }
  lines.push(`  ${paint(DIM, `Fix: ${f.fixType} · finding ${f.id}`)}`);
  return lines;
}

export function formatText(report: ScanReport, opts: { color?: boolean } = {}): string {
  const paint = painter(opts.color ?? false);
  const t = report.target;
  const target = t.kind === 'repo' ? `${t.root} (${t.filesScanned} files)` : t.url;
  const out = [paint(BOLD, `Legal Lint ${report.tool.version}`) + paint(DIM, ` · ${target} · intake: ${report.intake}`), ''];

  for (const f of report.findings) out.push(...formatFinding(f, paint), '');
  if (report.findings.length === 0) out.push('No findings.', '');

  for (const r of report.rulesRun.filter((r) => r.error)) {
    out.push(paint(RED, `${r.id} could not run: ${r.error}`));
  }
  const skipped = report.rulesRun.filter((r) => r.applies === 'no');
  if (skipped.length) out.push(paint(DIM, `Not applicable: ${skipped.map((r) => `${r.id} (${r.reason})`).join('; ')}`));

  const s = report.summary;
  out.push(`${s.open} open · ${s.needsJudgment} need judgment · ${s.needsIntake} need intake answers`);
  out.push(paint(DIM, report.disclaimer));
  return out.join('\n');
}
