import {
  LineMap,
  fileKind,
  importsOf,
  isNonShippingFile,
  isTruthyLiteral,
  jsxAttributeString,
  lineRange,
  objectProp,
  propertyName,
  stripHtmlComments,
  ts,
  walk,
  type RawFinding,
  type RepoIndex,
  type StaticEvidence,
} from '@legal-lint/core';
import { CONSENT, SDKS, type ReplaySdk, type SdkName } from './sdks.ts';

interface InitSite {
  sdk: SdkName;
  startLine: number;
  endLine: number;
  observed: string;
  /** recording: the code starts recording. maybe: recording depends on remote project settings (PostHog). */
  strength: 'recording' | 'maybe';
}

// ---------- consent gating ----------

function functionName(fn: ts.Node): string {
  if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn) || ts.isMethodDeclaration(fn)) && fn.name) {
    return fn.name.getText();
  }
  const p = fn.parent;
  if (p && ts.isVariableDeclaration(p)) return p.name.getText();
  if (p && ts.isPropertyAssignment(p)) return propertyName(p.name) ?? '';
  return '';
}

function isExit(stmt: ts.Statement): boolean {
  if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) return true;
  return ts.isBlock(stmt) && stmt.statements.length > 0 && isExit(stmt.statements[0]!);
}

/** True when the node only runs after a consent decision: inside a consent condition, callback or guard. */
export function isConsentGated(node: ts.Node, sf: ts.SourceFile): boolean {
  const text = (n: ts.Node) => n.getText(sf);
  for (let child: ts.Node = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isIfStatement(parent) && parent.thenStatement === child && CONSENT.test(text(parent.expression))) return true;
    if (ts.isConditionalExpression(parent) && parent.whenTrue === child && CONSENT.test(text(parent.condition))) return true;
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      parent.right === child &&
      CONSENT.test(text(parent.left))
    ) {
      return true;
    }
    if (ts.isFunctionLike(parent)) {
      const name = functionName(parent);
      if (CONSENT.test(name) || /^(on|handle)(Accept|Consent|Allow)/i.test(name)) return true;
      const holder = parent.parent;
      if (holder && ts.isCallExpression(holder) && holder.arguments.includes(parent as ts.Expression)) {
        const callee = text(holder.expression);
        if (CONSENT.test(callee)) return true;
        const event = holder.arguments[0];
        if (/addEventListener$|\.on$/.test(callee) && event && ts.isStringLiteralLike(event) && CONSENT.test(event.text)) return true;
      }
      if (holder && ts.isJsxExpression(holder) && holder.parent && ts.isJsxAttribute(holder.parent)) {
        const attr = holder.parent.name.getText(sf);
        if (/^on(Accept|Consent|Allow)/i.test(attr) || CONSENT.test(attr)) return true;
      }
      if (holder && ts.isPropertyAssignment(holder) && /^on(Accept|Consent|Allow|FirstConsent|Change)/i.test(propertyName(holder.name) ?? '')) {
        return true;
      }
    }
    // Early-return guard earlier in the same block: if (!hasConsent) return;
    if (ts.isBlock(parent) || ts.isSourceFile(parent)) {
      for (const stmt of parent.statements) {
        if (stmt === child) break;
        if (ts.isIfStatement(stmt) && isExit(stmt.thenStatement) && CONSENT.test(text(stmt.expression))) return true;
      }
    }
  }
  return false;
}

// ---------- script files ----------

function resolveObject(expr: ts.Expression | undefined, sf: ts.SourceFile): ts.Expression | undefined {
  if (!expr || !ts.isIdentifier(expr)) return expr;
  let found: ts.Expression | undefined;
  walk(sf, (n) => {
    if (!found && ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === expr.text) found = n.initializer;
  });
  return found ?? expr;
}

/** PostHog options decide whether recording happens and whether capture waits for opt-in. */
function postHogVerdict(options: ts.Expression | undefined): 'off' | 'gated' | InitSite['strength'] {
  if (isTruthyLiteral(objectProp(options, 'disable_session_recording'))) return 'off';
  if (isTruthyLiteral(objectProp(options, 'opt_out_capturing_by_default'))) return 'gated';
  return objectProp(options, 'session_recording') ? 'recording' : 'maybe';
}

function sdkForModule(module: string): ReplaySdk | undefined {
  return SDKS.find((s) => s.packages.includes(module));
}

function scriptSites(sf: ts.SourceFile): InitSite[] {
  const sites: InitSite[] = [];
  const imports = importsOf(sf);
  const bound = (name: string) => {
    const b = imports.get(name);
    return b ? sdkForModule(b.module) : undefined;
  };

  walk(sf, (node) => {
    // Hotjar.init(...), LogRocket.init(...), posthog.init(...), hotjar.initialize(...), or init(...) imported from the SDK.
    if (ts.isCallExpression(node)) {
      let sdk: ReplaySdk | undefined;
      let label = '';
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
        const candidate = bound(callee.expression.text);
        if (candidate?.initMethods.includes(callee.name.text)) {
          sdk = candidate;
          label = `${callee.expression.text}.${callee.name.text}()`;
        }
      } else if (ts.isIdentifier(callee)) {
        const b = imports.get(callee.text);
        const candidate = b ? sdkForModule(b.module) : undefined;
        if (candidate && b && candidate.initMethods.includes(b.imported)) {
          sdk = candidate;
          label = `${callee.text}()`;
        }
      }
      if (!sdk) return;
      let strength: InitSite['strength'] = 'recording';
      if (sdk.name === 'PostHog') {
        const verdict = postHogVerdict(resolveObject(node.arguments[1], sf));
        if (verdict === 'off' || verdict === 'gated') return;
        strength = verdict;
      }
      if (isConsentGated(node, sf)) return;
      sites.push({ sdk: sdk.name, ...lineRange(sf, node), observed: `${label} runs with no consent check`, strength });
      return;
    }

    if (!ts.isJsxSelfClosingElement(node) && !ts.isJsxOpeningElement(node)) return;
    const tag = node.tagName.getText(sf);

    // <PostHogProvider apiKey="..." options={{...}}> initialises PostHog itself.
    if (tag === 'PostHogProvider' && imports.get(tag)?.module === 'posthog-js/react' && jsxAttrExpr(node, 'apiKey')) {
      const verdict = postHogVerdict(resolveObject(jsxAttrExpr(node, 'options'), sf));
      if (verdict === 'off' || verdict === 'gated' || isConsentGated(node, sf)) return;
      sites.push({ sdk: 'PostHog', ...lineRange(sf, node), observed: '<PostHogProvider> starts PostHog with no consent check', strength: verdict });
      return;
    }

    // <Script src="https://static.hotjar.com/..."> or an inline snippet in <Script>/<script>.
    if (tag === 'Script' || tag === 'script') {
      const element = ts.isJsxOpeningElement(node) ? node.parent : node;
      const body = element.getText(sf);
      const sdk = SDKS.find((s) => s.snippet.test(body));
      if (!sdk) return;
      if (jsxAttributeString(node.attributes, 'type')?.value === 'text/plain') return;
      if (isConsentGated(element, sf) || CONSENT.test(body)) return;
      if (sdk.name === 'PostHog' && /disable_session_recording\s*:\s*true|opt_out_capturing_by_default\s*:\s*true/.test(body)) return;
      sites.push({
        sdk: sdk.name,
        ...lineRange(sf, element),
        observed: `${sdk.name} snippet in <${tag}> runs on page load`,
        strength: sdk.name === 'PostHog' ? 'maybe' : 'recording',
      });
    }
  });
  return sites;
}

function jsxAttrExpr(node: ts.JsxSelfClosingElement | ts.JsxOpeningElement, name: string): ts.Expression | undefined {
  for (const p of node.attributes.properties) {
    if (!ts.isJsxAttribute(p) || p.name.getText() !== name || !p.initializer) continue;
    if (ts.isJsxExpression(p.initializer)) return p.initializer.expression;
    return p.initializer;
  }
  return undefined;
}

// ---------- HTML-like files ----------

function markupSites(text: string): InitSite[] {
  const html = stripHtmlComments(text);
  const map = new LineMap(text);
  const sites: InitSite[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1]!;
    const body = m[2]!;
    const sdk = SDKS.find((s) => s.snippet.test(attrs) || s.snippet.test(body));
    if (!sdk) continue;
    // Consent managers block scripts by marking them text/plain until the visitor opts in.
    if (/type\s*=\s*["']?text\/plain/i.test(attrs)) continue;
    if (CONSENT.test(body)) continue;
    if (sdk.name === 'PostHog' && /disable_session_recording\s*:\s*true|opt_out_capturing_by_default\s*:\s*true/.test(body)) continue;
    sites.push({
      sdk: sdk.name,
      startLine: map.lineOf(m.index),
      endLine: map.lineOf(m.index + m[0].length - 1),
      observed: `${sdk.name} snippet runs on page load`,
      strength: sdk.name === 'PostHog' ? 'maybe' : 'recording',
    });
  }
  return sites;
}

// ---------- findings ----------

const CA_RISK =
  "Under California's Invasion of Privacy Act, recording visitors before telling them is the basis of class demand letters seeking statutory damages.";

function explain(sdk: SdkName, strength: InitSite['strength']): string {
  if (strength === 'maybe') {
    return (
      'PostHog starts here at page load with no consent check, and session recording is not turned off in code, so whether visitors are recorded depends on the PostHog project settings. ' +
      CA_RISK
    );
  }
  return `${sdk} session recording starts as soon as this code runs, with no consent check around it, so visitors' clicks and typing can be recorded before they are told. ${CA_RISK}`;
}

const SNIPPET_HINT = /fullstory|hotjar|logrocket|lr-ingest|lr-in\.com|lgrckt|clarity|posthog/i;

export async function detectStatic(repo: RepoIndex): Promise<RawFinding[]> {
  const findings: RawFinding[] = [];
  for (const file of repo.files) {
    const kind = fileKind(file);
    if ((kind !== 'script' && kind !== 'markup') || isNonShippingFile(file)) continue;
    const text = await repo.read(file);
    if (!SNIPPET_HINT.test(text)) continue;

    let sites: InitSite[] = [];
    if (kind === 'script') {
      const sf = await repo.sourceFile(file);
      if (sf) sites = scriptSites(sf);
    } else {
      sites = markupSites(text);
    }

    const map = new LineMap(text);
    for (const sdk of new Set(sites.map((s) => s.sdk))) {
      const mine = sites.filter((s) => s.sdk === sdk).sort((a, b) => a.startLine - b.startLine);
      const strength = mine.some((s) => s.strength === 'recording') ? 'recording' : 'maybe';
      const evidence: StaticEvidence[] = mine.map((s) => ({
        kind: 'static',
        file,
        startLine: s.startLine,
        endLine: s.endLine,
        snippet: map.snippet(s.startLine, Math.min(s.endLine, s.startLine + 2)),
        observed: s.observed,
      }));
      findings.push({
        key: `${file}#${sdk}`,
        confidence: strength === 'recording' ? 'high' : 'medium',
        evidence,
        explanation: explain(sdk, strength),
      });
    }
  }
  return findings;
}
