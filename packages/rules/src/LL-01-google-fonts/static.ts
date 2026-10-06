import {
  LineMap,
  fileKind,
  isNonShippingFile,
  jsxAttributeString,
  lineRange,
  stripCssComments,
  stripHtmlComments,
  ts,
  walk,
  type RawFinding,
  type RepoIndex,
  type StaticEvidence,
} from '@legal-lint/core';
import { findFontUrls, isFontAssetUrl, linkEffect, type FontUrl } from './hosts.ts';

/** load: the browser fetches from Google. preconnect: it opens a connection only. reference: a URL whose use we can't see. */
type Strength = 'load' | 'preconnect' | 'reference';

interface Hit {
  startLine: number;
  endLine: number;
  strength: Strength;
  observed: string;
}

const STATEMENT_START = /[;{}]/;

/** Finds Google font URLs used by CSS @import or url() in already comment-free CSS. */
function cssHits(css: string, base: number, lineOf: (offset: number) => number): Hit[] {
  const hits: Hit[] = [];
  for (const url of findFontUrls(css)) {
    let start = url.index;
    while (start > 0 && !STATEMENT_START.test(css[start - 1]!) && url.index - start < 400) start--;
    const prefix = css.slice(start, url.index);
    let observed: string | undefined;
    if (/@import\s*(?:url\(\s*)?["']?\s*$/i.test(prefix)) observed = `CSS @import from ${url.host}`;
    else if (/url\(\s*["']?\s*$/i.test(prefix)) observed = `CSS url() loading from ${url.host}`;
    if (!observed) continue;
    const line = lineOf(base + url.index);
    hits.push({ startLine: line, endLine: line, strength: 'load', observed });
  }
  return hits;
}

const ATTR = /\b([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/** Finds Google font loads in HTML: <link> tags and <style> blocks. `base` is the text's offset in its file. */
function htmlHits(text: string, base: number, lineOf: (offset: number) => number): Hit[] {
  const html = stripHtmlComments(text);
  const hits: Hit[] = [];

  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const a of tag[0].matchAll(ATTR)) attrs.set(a[1]!.toLowerCase(), a[2] ?? a[3] ?? a[4] ?? '');
    const url = findFontUrls(attrs.get('href') ?? '')[0];
    const effect = linkEffect(attrs.get('rel'));
    if (!url || !effect) continue;
    hits.push({
      startLine: lineOf(base + tag.index),
      endLine: lineOf(base + tag.index + tag[0].length - 1),
      strength: effect,
      observed: effect === 'load' ? `<link> loading from ${url.host}` : `<link rel="preconnect"> to ${url.host}`,
    });
  }

  for (const block of html.matchAll(/(<style\b[^>]*>)([\s\S]*?)<\/style>/gi)) {
    const scss = /lang\s*=\s*["']?(scss|sass|less)/i.test(block[1]!);
    const body = stripCssComments(block[2]!, scss);
    hits.push(...cssHits(body, base + block.index + block[1]!.length, lineOf));
  }
  return hits;
}

function isStringish(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateLiteralLikeNode {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  );
}

/** Local names bound to the webfontloader module, plus the conventional global. */
function webFontNames(sf: ts.SourceFile): Set<string> {
  const names = new Set(['WebFont']);
  walk(sf, (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'webfontloader') {
      const clause = node.importClause;
      if (clause?.name) names.add(clause.name.text);
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) names.add(clause.namedBindings.name.text);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(sf) === 'require' &&
      node.initializer.arguments[0] &&
      ts.isStringLiteral(node.initializer.arguments[0]) &&
      node.initializer.arguments[0].text === 'webfontloader'
    ) {
      names.add(node.name.text);
    }
  });
  return names;
}

function scriptHits(sf: ts.SourceFile): Hit[] {
  const hits: Hit[] = [];
  const handled = new Set<ts.Node>();
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const webFont = webFontNames(sf);

  walk(sf, (node) => {
    // <link rel="stylesheet" href="https://fonts.googleapis.com/..." /> in JSX
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(sf) === 'link') {
      const href = jsxAttributeString(node.attributes, 'href');
      const url = href && findFontUrls(href.value)[0];
      if (!href || !url) return;
      handled.add(href.node);
      const effect = linkEffect(jsxAttributeString(node.attributes, 'rel')?.value);
      if (!effect) return;
      hits.push({
        ...lineRange(sf, node),
        strength: effect,
        observed: effect === 'load' ? `<link> loading from ${url.host}` : `<link rel="preconnect"> to ${url.host}`,
      });
      return;
    }

    // WebFont.load({ google: { families: [...] } }) fetches from Google without the host in the source.
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'load' &&
      ts.isIdentifier(node.expression.expression) &&
      webFont.has(node.expression.expression.text)
    ) {
      const arg = node.arguments[0];
      const hasGoogle =
        arg &&
        ts.isObjectLiteralExpression(arg) &&
        arg.properties.some((p) => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === 'google');
      if (hasGoogle) hits.push({ ...lineRange(sf, node), strength: 'load', observed: 'webfontloader loading Google Fonts' });
      return;
    }

    // A template with substitutions is read whole, so a tag split by ${...} is still one tag.
    if (ts.isTemplateExpression(node)) {
      handled.add(node.head);
      for (const span of node.templateSpans) handled.add(span.literal);
    } else if (!isStringish(node) || handled.has(node)) {
      return;
    }
    const raw = node.getText(sf);
    const urls = findFontUrls(raw);
    if (urls.length === 0) return;

    // HTML inside a string: print windows, server-rendered pages, email templates.
    if (/<(link|style)\b/i.test(raw)) {
      hits.push(...htmlHits(raw, node.getStart(sf), lineOf));
      return;
    }
    // CSS inside a string: styled-components createGlobalStyle, <style jsx global>, emotion, etc.
    if (/@import|url\(/i.test(raw)) {
      hits.push(...cssHits(stripCssComments(raw), node.getStart(sf), lineOf));
      return;
    }
    const assets = urls.filter((u: FontUrl) => isFontAssetUrl(u));
    if (assets.length > 0) {
      const { startLine, endLine } = lineRange(sf, node);
      hits.push({ startLine, endLine, strength: 'reference', observed: `URL to ${assets[0]!.host} in code` });
    }
  });
  return hits;
}

const STRENGTH_ORDER: Record<Strength, number> = { load: 0, preconnect: 1, reference: 2 };

function explain(strongest: Strength): string {
  switch (strongest) {
    case 'load':
      return (
        "This file loads fonts from Google's servers, so each visitor's browser sends its IP address to Google on page load, before any consent. " +
        'For EU visitors, this is the pattern behind the 2022 Munich court ruling and the wave of warning letters that followed.'
      );
    case 'preconnect':
      return (
        "This file tells the browser to open a connection to Google's font servers on page load, which sends the visitor's IP address to Google even if no font is downloaded. " +
        'It looks like leftover Google Fonts setup, and for EU visitors it may carry the same risk as the 2022 Munich ruling.'
      );
    case 'reference':
      return (
        "This file contains a URL to Google's font servers, but the scan could not see how it is used. " +
        "If the browser loads it, each visitor's IP address goes to Google on page load, the pattern behind the 2022 Munich court ruling."
      );
  }
}

export async function detectStatic(repo: RepoIndex): Promise<RawFinding[]> {
  const findings: RawFinding[] = [];
  for (const file of repo.files) {
    const kind = fileKind(file);
    if (kind === 'other' || isNonShippingFile(file)) continue;
    const text = await repo.read(file);
    if (!/fonts\.(googleapis|gstatic)\.com|webfont/i.test(text)) continue;

    let hits: Hit[];
    if (kind === 'script') {
      const sf = await repo.sourceFile(file);
      hits = sf ? scriptHits(sf) : [];
    } else if (kind === 'markup') {
      const map = new LineMap(text);
      hits = htmlHits(text, 0, (o) => map.lineOf(o));
    } else {
      const map = new LineMap(text);
      hits = cssHits(stripCssComments(text, kind === 'scss'), 0, (o) => map.lineOf(o));
    }
    if (hits.length === 0) continue;

    const map = new LineMap(text);
    const unique = new Map<string, Hit>();
    for (const h of hits) unique.set(`${h.startLine}:${h.observed}`, h);
    const sorted = [...unique.values()].sort((a, b) => a.startLine - b.startLine);
    const strongest = sorted.reduce<Strength>(
      (best, h) => (STRENGTH_ORDER[h.strength] < STRENGTH_ORDER[best] ? h.strength : best),
      'reference',
    );
    const evidence: StaticEvidence[] = sorted.map((h) => ({
      kind: 'static',
      file,
      startLine: h.startLine,
      endLine: h.endLine,
      snippet: map.snippet(h.startLine, h.endLine),
      observed: h.observed,
    }));
    // A bare URL is weak evidence on its own; building a <link> element in the same file makes a load likely.
    const createsLink = /createElement\(\s*['"`]link['"`]\s*\)/.test(text);
    findings.push({
      key: file,
      confidence: strongest === 'load' ? 'high' : strongest === 'preconnect' || createsLink ? 'medium' : 'low',
      evidence,
      explanation: explain(strongest),
    });
  }
  return findings;
}
