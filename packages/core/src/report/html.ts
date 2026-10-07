import type { Evidence, Finding, RuleRun, ScanReport } from '../types.ts';

// A single self-contained page for the founder: no scripts, no external fonts
// or styles (a report that loaded Google Fonts would trip LL-01 itself), and
// every value from the scan escaped.

const EXPOSURE_LABEL = {
  statutory_max: 'Statutory maximum',
  named_case: 'Named case',
  consequence: 'Consequence',
} as const;

const SECTIONS = [
  {
    status: 'open',
    title: 'To fix',
    intro: 'Each of these was observed in the scan. Your coding agent can follow the fix guidance and re-scan to confirm.',
  },
  {
    status: 'needs_judgment',
    title: 'Needs a decision',
    intro: 'The scanner could not tell on its own. Your coding agent can read the material and answer, or you can.',
  },
  {
    status: 'needs_intake',
    title: 'Needs an answer from you',
    intro: 'Whether these apply depends on your business. Answer the question in legal-lint.config.json, or run legal-lint init.',
  },
] as const;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function headline(s: ScanReport['summary']): string {
  if (s.open === 0 && s.needsJudgment === 0 && s.needsIntake === 0) return 'Nothing to fix right now.';
  const parts: string[] = [];
  if (s.open) parts.push(plural(s.open, 'finding to fix', 'findings to fix'));
  if (s.needsJudgment) parts.push(plural(s.needsJudgment, 'decision to make', 'decisions to make'));
  if (s.needsIntake) parts.push(plural(s.needsIntake, 'question for you', 'questions for you'));
  const last = parts.pop()!;
  return `${parts.length ? `${parts.join(', ')} and ${last}` : last}.`;
}

function evidenceHtml(e: Evidence): string {
  switch (e.kind) {
    case 'static': {
      const where = e.startLine === e.endLine ? `${e.file}:${e.startLine}` : `${e.file}:${e.startLine}-${e.endLine}`;
      return `<li><code class="where">${esc(where)}</code><p>${esc(e.observed)}</p><pre>${esc(e.snippet)}</pre></li>`;
    }
    case 'runtime':
      return `<li><code class="where">${esc(e.requestUrl)}</code><p>${esc(e.observed)}. Requested ${e.msSinceNavigation} ms after the page started loading, before any click, on <code>${esc(e.pageUrl)}</code> (${esc(e.resourceType)}).</p></li>`;
    case 'absence':
      return `<li><p class="absent">${esc(e.observed)}</p><p class="looked">Looked at: ${esc(e.looked.join(', '))}</p></li>`;
  }
}

function findingHtml(f: Finding): string {
  const extra: string[] = [];
  if (f.status === 'needs_judgment') {
    extra.push(
      `<div class="ask"><p><strong>${esc(f.judgment.question)}</strong></p><ul>${f.judgment.options
        .map((o) => `<li><code>${esc(o.value)}</code> ${esc(o.meaning)}</li>`)
        .join('')}</ul></div>`,
    );
  }
  if (f.status === 'needs_intake') {
    extra.push(
      `<div class="ask"><ul>${f.questions.map((q) => `<li><code>intake.${esc(q.key)}</code> ${esc(q.question)}</li>`).join('')}</ul></div>`,
    );
  }
  return `<article class="finding ${f.status}" id="${esc(f.id)}">
<header><h3><span class="rule">${esc(f.ruleId)}</span> ${esc(f.ruleName)}</h3><p class="conf">${esc(f.confidence)} confidence</p></header>
<p class="explain">${esc(f.explanation)}</p>
${extra.join('\n')}
<h4>${f.evidence.length === 1 ? 'Where' : `Where (${f.evidence.length} places)`}</h4>
<ul class="evidence">${f.evidence.map(evidenceHtml).join('')}</ul>
<dl>
<dt>Does not apply if</dt><dd>${esc(f.doesNotApplyIf)}</dd>
<dt>Exposure (${esc(EXPOSURE_LABEL[f.exposure.kind].toLowerCase())})</dt><dd>${esc(f.exposure.text)}</dd>
<dt>Fix</dt><dd>${f.fixType === 'full' ? 'Code changes cover it.' : 'Code changes cover part of it; some steps only you can do.'} Finding <code>${esc(f.id)}</code>.</dd>
</dl>
</article>`;
}

function ruleRowHtml(run: RuleRun, findings: Finding[]): string {
  const mine = findings.filter((f) => f.ruleId === run.id);
  let state: string;
  let cls: string;
  if (run.error) {
    state = `Could not run: ${run.error}`;
    cls = 'error';
  } else if (run.applies === 'no') {
    state = `Not applicable. ${run.reason}`;
    cls = 'skip';
  } else if (mine.length === 0) {
    state = 'Nothing found';
    cls = 'clear';
  } else {
    const open = mine.filter((f) => f.status === 'open').length;
    const asks = mine.length - open;
    state = [open ? plural(open, 'to fix', 'to fix') : '', asks ? plural(asks, 'question', 'questions') : ''].filter(Boolean).join(', ');
    cls = open ? 'open' : 'ask';
  }
  return `<tr class="${cls}"><th scope="row">${esc(run.id)}</th><td>${esc(run.name)}</td><td>${esc(state)}</td></tr>`;
}

const CSS = `
:root{--bg:#f5f6f8;--paper:#ffffff;--ink:#18202e;--muted:#5a6476;--line:#d8dde5;--open:#b42318;--ask:#a15c07;--clear:#2b6b4f;--code:#eef1f5}
@media (prefers-color-scheme:dark){:root{--bg:#121620;--paper:#1a1f2b;--ink:#e5e8ee;--muted:#9aa3b2;--line:#2e3646;--open:#f0786c;--ask:#e3a548;--clear:#6cc19a;--code:#232a38}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:52rem;margin:0 auto;padding:2.5rem 1rem 4rem}
.meta{color:var(--muted);font-size:.9rem;margin:0}
h1{font-family:Charter,"Bitstream Charter","Iowan Old Style",Georgia,serif;font-weight:600;font-size:clamp(1.9rem,5vw,2.8rem);line-height:1.15;margin:.6rem 0 1.4rem;max-width:22ch}
.tally{display:flex;flex-wrap:wrap;gap:.5rem 1.5rem;margin:0 0 2.5rem;padding:0;list-style:none;font-size:.95rem}
.tally b{font-size:1.4rem;margin-right:.3rem}
.tally .t-open b{color:var(--open)}.tally .t-ask b{color:var(--ask)}
h2{font-family:Charter,"Bitstream Charter","Iowan Old Style",Georgia,serif;font-size:1.5rem;margin:2.5rem 0 .3rem}
section>p.intro{color:var(--muted);margin:0 0 1rem;max-width:65ch}
table{width:100%;border-collapse:collapse;background:var(--paper);border:1px solid var(--line);font-size:.95rem}
th,td{text-align:left;padding:.55rem .75rem;border-top:1px solid var(--line);vertical-align:top}
thead th{border-top:0;color:var(--muted);font-weight:500}
tbody th{white-space:nowrap}
tr.open td:last-child{color:var(--open);font-weight:600}tr.ask td:last-child{color:var(--ask);font-weight:600}
tr.clear td:last-child{color:var(--clear)}tr.skip td:last-child,tr.error td:last-child{color:var(--muted)}
.finding{background:var(--paper);border:1px solid var(--line);border-left:5px solid var(--line);padding:1.1rem 1.25rem;margin:0 0 1rem}
.finding.open{border-left-color:var(--open)}.finding.needs_judgment,.finding.needs_intake{border-left-color:var(--ask)}
.finding header{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:.25rem 1rem}
h3{margin:0;font-size:1.1rem}
.rule{color:var(--muted);font-weight:500;margin-right:.35rem}
.conf{margin:0;color:var(--muted);font-size:.85rem}
.explain{max-width:65ch}
h4{font-size:.85rem;color:var(--muted);font-weight:500;margin:1rem 0 .4rem}
.evidence{list-style:none;padding:0;margin:0}
.evidence li{padding:.5rem 0;border-top:1px dashed var(--line)}
.evidence li:first-child{border-top:0;padding-top:0}
.evidence p{margin:.2rem 0}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em;overflow-wrap:anywhere}
.where{font-weight:600}
pre{background:var(--code);padding:.5rem .7rem;margin:.35rem 0 0;overflow-x:auto;font:.82rem/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.absent{font-weight:600}.looked{color:var(--muted);font-size:.85rem}
.ask{background:var(--code);padding:.6rem .9rem;margin:.6rem 0}
.ask p{margin:0 0 .3rem}.ask ul{margin:0;padding-left:1.1rem}
dl{display:grid;grid-template-columns:minmax(9rem,max-content) 1fr;gap:.35rem 1rem;margin:1rem 0 0;font-size:.92rem}
dt{color:var(--muted)}dd{margin:0}
@media (max-width:560px){dl{grid-template-columns:1fr}dd{margin-bottom:.4rem}}
footer{margin-top:3rem;padding-top:1rem;border-top:1px solid var(--line);color:var(--muted);font-size:.9rem}
`;

/** Renders a scan report as one self-contained HTML page for the person who owns the product. */
export function formatHtml(report: ScanReport, opts: { generatedAt?: Date } = {}): string {
  const t = report.target;
  const target = t.kind === 'repo' ? `${t.root}, ${plural(t.filesScanned, 'file', 'files')} scanned` : `${t.url}, ${plural(t.pagesVisited.length, 'page', 'pages')} visited`;
  const when = (opts.generatedAt ?? new Date()).toISOString().replace('T', ' ').slice(0, 16);
  const s = report.summary;

  const sections = SECTIONS.map(({ status, title, intro }) => {
    const items = report.findings.filter((f) => f.status === status);
    if (items.length === 0) return '';
    return `<section><h2>${title}</h2><p class="intro">${intro}</p>\n${items.map(findingHtml).join('\n')}</section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Legal Lint report</title>
<style>${CSS}</style>
</head>
<body>
<main>
<p class="meta">Legal Lint ${esc(report.tool.version)} scanned ${esc(target)} on ${when} UTC. Project answers: ${report.intake === 'loaded' ? 'loaded' : 'none yet'}.</p>
<h1>${headline(s)}</h1>
<ul class="tally">
<li class="t-open"><b>${s.open}</b>to fix</li>
<li class="t-ask"><b>${s.needsJudgment}</b>need a decision</li>
<li class="t-ask"><b>${s.needsIntake}</b>need your answer</li>
</ul>
<section><h2>By rule</h2>
<table><thead><tr><th scope="col">Rule</th><th scope="col">Name</th><th scope="col">Result</th></tr></thead>
<tbody>${report.rulesRun.map((r) => ruleRowHtml(r, report.findings)).join('')}</tbody></table>
</section>
${sections}
<footer><p>${esc(report.disclaimer)}</p></footer>
</main>
</body>
</html>
`;
}
