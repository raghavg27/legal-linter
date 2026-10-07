import {
  importsOf,
  listRoutes,
  type Evidence,
  type RawFinding,
  type RepoIndex,
  type RouteInfo,
} from '@legal-lint/core';
import { findEmailSends, resolveImport, templateContent, type EmailSend, type TemplateContent } from '../shared/email.ts';

// ---------- classification ----------

const MARKETING =
  /newsletter|digest|promo(tion|tional)?|offer|discount|\bsale\b|coupon|\bdeals?\b|launch|announce(ment)?|campaign|broadcast|drip|nurture|re-?engage|win-?back|we miss you|product[- ]?updates?|what'?s new|weekly|monthly|changelog|% off/i;
const TRANSACTIONAL =
  /reset|password|verif(y|ication)|confirm(ation)?|magic[- ]?link|sign[- ]?in|log[- ]?in|\botp\b|one[- ]time|\bcode\b|receipt|invoice|\border\b|payment|billing|refund|security|alert|2fa|two[- ]factor|invit(e|ation)|shipping|delivery|notification|\btest\b/i;

export type Classification = 'marketing' | 'transactional' | 'unclear';

/** Names and subject only: template bodies mention "order" or "sale" too often to be a signal. */
export function classify(send: EmailSend): Classification {
  const names = [
    send.subject ?? '',
    send.body.kind === 'component' ? `${send.body.name} ${send.body.file ?? ''}` : '',
    send.body.kind === 'remote' ? send.body.ref : '',
    send.file,
    send.functionName ?? '',
  ]
    .join(' ')
    // Split camelCase and kebab-case so "WeeklyDigest" and "weekly-digest" both read as words.
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_/.]/g, ' ');
  const marketing = MARKETING.test(names) || send.toList;
  const transactional = TRANSACTIONAL.test(names);
  if (marketing && !transactional) return 'marketing';
  if (transactional && !marketing) return 'transactional';
  return 'unclear';
}

// ---------- footer ----------

const UNSUBSCRIBE =
  /unsubscribe|opt[- ]?out|email[- ]preferences|manage (your )?(email )?(preferences|subscription)|RESEND_UNSUBSCRIBE_URL|asm_group_unsubscribe|pm:unsubscribe|%(tag_)?unsubscribe_url%|\{\{\s*unsubscribe/i;
const ADDRESS = [
  /\b\d{1,6}\s+(?:[A-Za-z0-9][\w.'-]*\s+){1,4}(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|way|court|ct|place|pl|square|sq|parkway|pkwy)\b/i,
  /\bP\.?\s?O\.?\s+Box\s+\d+/i,
  /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/,
  /\b(company|postal|mailing|physical|business|sender)[_ ]?address\b|\{\{\s*address\s*\}\}|\[COMPANY POSTAL ADDRESS\]/i,
];

function footerGaps(content: TemplateContent): string[] {
  const all = `${content.raw}\n${content.text}`;
  const gaps: string[] = [];
  if (!UNSUBSCRIBE.test(all)) gaps.push('Template has no unsubscribe link');
  if (!ADDRESS.some((re) => re.test(all))) gaps.push('Template has no postal address');
  return gaps;
}

// ---------- suppression ----------

const UNSUB_ROUTE = /unsubscribe|opt-?out|email-preferences|preferences|subscriptions?\/manage/i;
// Names a writer and a reader of the suppression list share. Plain "unsubscribe" is excluded: it is the route and link text.
const LIST_FIELD = /\b\w*(unsubscribed|suppress\w*|opt_?out\w*|opted_?out|subscribed|marketing_?(consent|opt_?in|emails?)|email_?opt_?in|newsletter_?(opt_?in|subscribed))\w*\b/gi;

async function filesReadBy(repo: RepoIndex, file: string): Promise<string[]> {
  const sf = await repo.sourceFile(file);
  if (!sf) return [file];
  const out = [file];
  for (const { module } of importsOf(sf).values()) {
    const resolved = resolveImport(repo, file, module);
    if (resolved && !out.includes(resolved)) out.push(resolved);
  }
  return out;
}

async function suppressionGap(repo: RepoIndex, send: EmailSend, routes: RouteInfo[]): Promise<string | null> {
  if (send.managedUnsubscribe) return null;
  const unsubRoutes = routes.filter((r) => UNSUB_ROUTE.test(r.path) || UNSUB_ROUTE.test(r.file));
  if (unsubRoutes.length === 0) return 'No unsubscribe route or handler found';

  const fields = new Set<string>();
  for (const r of unsubRoutes) for (const m of (await repo.read(r.file)).matchAll(LIST_FIELD)) fields.add(m[0].toLowerCase());
  // The route writes something we cannot name: stay quiet rather than guess.
  if (fields.size === 0) return null;

  for (const f of await filesReadBy(repo, send.file)) {
    const text = (await repo.read(f)).toLowerCase();
    if ([...fields].some((name) => new RegExp(`\\b${name}\\b`).test(text))) return null;
  }
  return 'The send path does not read the unsubscribe list';
}

// ---------- findings ----------

const PHRASES: Record<string, string> = {
  'Template has no unsubscribe link': 'has no unsubscribe link',
  'Template has no postal address': 'has no postal address',
  'No unsubscribe route or handler found': 'has no unsubscribe handler behind it',
  'The send path does not read the unsubscribe list': 'is sent without checking who unsubscribed',
};

function joinPhrases(gaps: string[]): string {
  const parts = gaps.map((g) => PHRASES[g]!);
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

function describeBody(send: EmailSend): string {
  switch (send.body.kind) {
    case 'component':
      return send.body.file ? `template ${send.body.file}` : `template <${send.body.name}>`;
    case 'inline':
      return 'inline content';
    case 'remote':
      return `provider-hosted template ${send.body.ref}`;
    case 'unknown':
      return 'a body the scan could not resolve';
  }
}

function keyOf(send: EmailSend, index: number): string {
  if (send.body.kind === 'component') return `${send.file}#${send.body.file ?? send.body.name}`;
  if (send.body.kind === 'remote') return `${send.file}#${send.body.ref}`;
  return `${send.file}#${send.subject ?? `send-${index}`}`;
}

export async function detectStatic(repo: RepoIndex): Promise<RawFinding[]> {
  const sends = await findEmailSends(repo);
  if (sends.length === 0) return [];
  const routes = await listRoutes(repo);
  const findings: RawFinding[] = [];

  for (const [i, send] of sends.entries()) {
    const kind = classify(send);
    if (kind === 'transactional') continue;

    const content = await templateContent(repo, send);
    // Provider-hosted or unresolved bodies: the footer cannot be seen, so only suppression is checked.
    const gaps = [...(content ? footerGaps(content) : [])];
    const suppression = await suppressionGap(repo, send, routes);
    if (suppression) gaps.push(suppression);
    if (gaps.length === 0) continue;

    const evidence: Evidence[] = [
      {
        kind: 'static',
        file: send.file,
        startLine: send.startLine,
        endLine: send.endLine,
        snippet: send.snippet,
        observed: `${send.label} with ${describeBody(send)}`,
      },
      ...gaps.map((g): Evidence => ({ kind: 'absence', looked: content?.files.length ? content.files : [send.file], observed: g })),
    ];

    if (kind === 'marketing') {
      findings.push({
        key: keyOf(send, i),
        confidence: send.managedUnsubscribe || /\.broadcasts\./.test(send.label) ? 'high' : 'medium',
        evidence,
        explanation:
          `This ${send.provider} email looks like marketing and ${joinPhrases(gaps)}. ` +
          'Commercial email without an unsubscribe option, a postal address and suppression of opt-outs is the CAN-SPAM risk, with penalties counted per email.',
      });
      continue;
    }

    const material = [
      ...(content
        ? [{ label: 'Email template', file: content.files[0], content: content.raw.slice(0, 4000) }]
        : []),
      { label: 'Send call', file: send.file, lines: [send.startLine, send.endLine] as [number, number], content: send.callText },
    ];
    findings.push({
      key: keyOf(send, i),
      confidence: 'medium',
      evidence,
      explanation:
        `This ${send.provider} email ${joinPhrases(gaps)}, and the scan could not tell whether it is marketing or transactional. ` +
        'If it is marketing, sending it like this is the CAN-SPAM risk, with penalties counted per email.',
      judgment: {
        question:
          'Is this email marketing (a newsletter, promotion, announcement or re-engagement message) or transactional (a receipt, password reset, or an update about the recipient\'s own account or order)? Decide from the template and where it is sent.',
        options: [
          { value: 'marketing', outcome: 'open', meaning: 'Its main purpose is to promote a product, service or content.' },
          { value: 'transactional', outcome: 'drop', meaning: 'It completes or updates something the recipient already started or bought.' },
        ],
        material,
      },
    });
  }
  return findings;
}
