import {
  LineMap,
  calleeText,
  fileKind,
  importsOf,
  isNonShippingFile,
  lineRange,
  listRoutes,
  markupText,
  objectProp,
  scriptText,
  ts,
  walk,
  type Evidence,
  type RawFinding,
  type RepoIndex,
  type StaticEvidence,
} from '@legal-lint/core';
import { findEmailSends, templateContent } from '../shared/email.ts';
import { ARL_RISK, GAP, PHRASE, hasRenewalDisclosure } from './signals.ts';

// ---------- where subscriptions are created ----------

type Provider = 'Stripe' | 'Paddle' | 'Lemon Squeezy' | 'Razorpay';

const CREATION_HINT = /checkout\.sessions|subscriptions\.create|Checkout\.open|createCheckout|LemonSqueezy|stripe-pricing-table/;

function resolveLocal(expr: ts.Expression | undefined, sf: ts.SourceFile): ts.Expression | undefined {
  if (!expr || !ts.isIdentifier(expr)) return expr;
  let found: ts.Expression | undefined;
  walk(sf, (n) => {
    if (!found && ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === expr.text) found = n.initializer;
  });
  return found ?? expr;
}

/** Stripe Checkout defaults to one-time payment; only mode "subscription" (possibly in a ternary) is a subscription. */
function isSubscriptionMode(arg: ts.Expression | undefined, sf: ts.SourceFile): boolean {
  const mode = objectProp(resolveLocal(arg, sf), 'mode');
  return !!mode && /['"`]subscription['"`]/.test(mode.getText(sf));
}

async function findCreations(repo: RepoIndex): Promise<(StaticEvidence & { provider: Provider })[]> {
  const has = (...pkgs: string[]) => pkgs.some((p) => repo.hasDependency(p));
  const stripe = has('stripe', '@stripe/stripe-js');
  const paddle = has('@paddle/paddle-js', '@paddle/paddle-node-sdk');
  const lemon = has('@lemonsqueezy/lemonsqueezy.js');
  const razorpay = has('razorpay');
  if (!stripe && !paddle && !lemon && !razorpay) return [];

  const out: (StaticEvidence & { provider: Provider })[] = [];
  for (const file of repo.files) {
    const kind = fileKind(file);
    if ((kind !== 'script' && kind !== 'markup') || isNonShippingFile(file)) continue;
    const text = await repo.read(file);
    if (!CREATION_HINT.test(text)) continue;
    const map = new LineMap(text);
    const push = (provider: Provider, startLine: number, endLine: number, observed: string) =>
      out.push({ kind: 'static', provider, file, startLine, endLine, snippet: map.snippet(startLine, Math.min(endLine, startLine + 1)), observed });

    if (kind === 'markup') {
      const m = /<stripe-pricing-table\b/.exec(text);
      if (m && stripe) push('Stripe', map.lineOf(m.index), map.lineOf(m.index), 'Stripe pricing table');
      continue;
    }
    const sf = await repo.sourceFile(file);
    if (!sf) continue;
    const imports = importsOf(sf);
    walk(sf, (node) => {
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(sf) === 'stripe-pricing-table' && stripe) {
        const r = lineRange(sf, node);
        push('Stripe', r.startLine, r.endLine, 'Stripe pricing table');
        return;
      }
      if (!ts.isCallExpression(node)) return;
      const callee = calleeText(sf, node);
      const r = lineRange(sf, node);
      if (stripe && /\.checkout\.sessions\.create$/.test(callee) && isSubscriptionMode(node.arguments[0], sf)) {
        push('Stripe', r.startLine, r.endLine, 'Stripe Checkout session in subscription mode');
      } else if (stripe && /\.subscriptions\.create$/.test(callee) && !razorpay) {
        push('Stripe', r.startLine, r.endLine, 'Stripe subscription created');
      } else if (razorpay && /\.subscriptions\.create$/.test(callee)) {
        push('Razorpay', r.startLine, r.endLine, 'Razorpay subscription created');
      } else if (paddle && /(^|\.)Checkout\.open$/.test(callee)) {
        push('Paddle', r.startLine, r.endLine, 'Paddle checkout opened');
      } else if (lemon && (imports.get(callee)?.module === '@lemonsqueezy/lemonsqueezy.js' && imports.get(callee)?.imported === 'createCheckout')) {
        push('Lemon Squeezy', r.startLine, r.endLine, 'Lemon Squeezy checkout created');
      } else if (lemon && /LemonSqueezy\.Url\.Open$/.test(callee)) {
        push('Lemon Squeezy', r.startLine, r.endLine, 'Lemon Squeezy checkout opened');
      }
    });
  }
  return out;
}

// ---------- the checkout UI ----------

const UI_FILE = /\.(tsx|jsx|vue|svelte|astro|html?)$/;
const UI_PATH = /(pricing|checkout|billing|upgrade|plans?|subscribe|subscription|paywall)/i;
const UI_TRIGGER = /redirectToCheckout|Checkout\.open|LemonSqueezy\.Url\.Open|stripe-pricing-table|\/api\/(stripe\/)?(checkout|subscribe|billing)|createCheckout|checkout\.sessions/;

const CHECKBOX = /type=["']checkbox["']|<Checkbox\b|role=["']checkbox["']/;
const CONSENT_LABEL = /\b(agree|consent|authori[sz]e|accept)\w*\b[\s\S]{0,120}\b(terms|renew\w*|recurring|charge\w*|subscription|billing)\b/i;
const PRE_CHECKED = /defaultChecked(\s*=\s*\{\s*true\s*\})?(?=[\s/>])|\bchecked(\s*=\s*\{\s*true\s*\})?(?=[\s/>])/;

interface UiFile {
  file: string;
  raw: string;
  text: string;
}

async function checkoutUi(repo: RepoIndex): Promise<UiFile[]> {
  const out: UiFile[] = [];
  for (const file of repo.files) {
    if (!UI_FILE.test(file) || isNonShippingFile(file)) continue;
    const raw = await repo.read(file);
    if (!UI_PATH.test(file) && !UI_TRIGGER.test(raw)) continue;
    const sf = await repo.sourceFile(file);
    out.push({ file, raw, text: sf ? scriptText(sf) : markupText(raw) });
  }
  return out;
}

// ---------- cancellation and confirmation ----------

const CANCEL_CODE =
  /billingPortal\.sessions\.create|\.subscriptions\.(cancel|del)\s*\(|cancel_at_period_end\s*:\s*true|customer_portal|cancelSubscription\s*\(|management_urls|customerPortalSessions/;
// Not plain "cancel": /checkout/cancel is where abandoned checkouts land, not a way to end a subscription.
const CANCEL_ROUTE = /cancel[-_]?subscription|subscriptions?\/cancel|billing[-_/]?portal|customer[-_]?portal|manage[-_]?subscription/i;
const EMAIL_PATH = /(^|\/)(emails?|mail(ers?)?|templates?)\/|(email|mail)[^/]*$/i;
const TERMS_IN_EMAIL = (t: string) => /(subscription|subscribed|your plan|membership)/i.test(t) && /(renew|cancel)/i.test(t);

async function hasOnlineCancel(repo: RepoIndex): Promise<boolean> {
  if ((await listRoutes(repo)).some((r) => CANCEL_ROUTE.test(r.path))) return true;
  for (const file of repo.files) {
    if (fileKind(file) !== 'script' || isNonShippingFile(file)) continue;
    if (CANCEL_CODE.test(await repo.read(file))) return true;
  }
  return false;
}

async function hasConfirmationEmail(repo: RepoIndex): Promise<boolean> {
  for (const file of repo.files) {
    if (!EMAIL_PATH.test(file) || isNonShippingFile(file) || (fileKind(file) === 'other' && !/\.(mjml|hbs|md|txt)$/.test(file))) continue;
    const raw = await repo.read(file);
    const sf = await repo.sourceFile(file);
    if (TERMS_IN_EMAIL(sf ? scriptText(sf) : markupText(raw))) return true;
  }
  for (const send of await findEmailSends(repo)) {
    const content = await templateContent(repo, send);
    if (content && TERMS_IN_EMAIL(content.text)) return true;
  }
  return false;
}

// ---------- finding ----------

function joinPhrases(gaps: string[]): string {
  const parts = gaps.map((g) => PHRASE[g]!);
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

export async function detectStatic(repo: RepoIndex): Promise<RawFinding[]> {
  const creations = await findCreations(repo);
  if (creations.length === 0) return [];

  const gaps: string[] = [];
  const ui = await checkoutUi(repo);
  // Without checkout UI in the repo (for example a hosted checkout link), the disclosure and checkbox cannot be judged here.
  if (ui.length > 0) {
    if (!ui.some((u) => hasRenewalDisclosure(u.text))) gaps.push(GAP.disclosure);
    const consentBoxes = ui.filter((u) => CHECKBOX.test(u.raw) && CONSENT_LABEL.test(u.text));
    if (consentBoxes.length === 0) gaps.push(GAP.consent);
    else if (consentBoxes.every((u) => PRE_CHECKED.test(u.raw))) gaps.push(GAP.preChecked);
  }
  if (!(await hasOnlineCancel(repo))) gaps.push(GAP.cancel);
  if (!(await hasConfirmationEmail(repo))) gaps.push(GAP.confirmation);
  if (gaps.length === 0) return [];

  const looked = ui.length ? ui.map((u) => u.file) : creations.map((c) => c.file);
  const providers = [...new Set(creations.map((c) => c.provider))].join(' and ');
  const evidence: Evidence[] = [
    ...creations.slice(0, 3).map(({ provider: _p, ...e }) => e),
    ...gaps.map((g): Evidence => ({ kind: 'absence', looked, observed: g })),
  ];
  return [
    {
      key: 'subscription-checkout',
      confidence: 'medium',
      evidence,
      explanation: `This app sells ${providers} subscriptions, and the scan found no sign of ${joinPhrases(gaps)}. ${ARL_RISK}`,
    },
  ];
}
