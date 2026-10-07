import path from 'node:path';
import {
  LineMap,
  calleeText,
  fileKind,
  importsOf,
  isNonShippingFile,
  lineRange,
  markupText,
  propertyName,
  scriptText,
  ts,
  walk,
  type RepoIndex,
} from '@legal-lint/core';

export type Provider = 'Resend' | 'SendGrid' | 'Postmark' | 'Amazon SES' | 'Mailgun' | 'Nodemailer';

export type EmailBody =
  | { kind: 'inline'; content: string }
  | { kind: 'component'; name: string; file?: string }
  | { kind: 'remote'; ref: string }
  | { kind: 'unknown' };

export interface EmailSend {
  file: string;
  provider: Provider;
  label: string;
  startLine: number;
  endLine: number;
  snippet: string;
  /** The source of the send call, cut to a maximum length, for the judgment material. */
  callText: string;
  subject?: string;
  body: EmailBody;
  /** The provider manages unsubscribes and suppression (Resend broadcasts/audiences, SendGrid ASM groups, Postmark broadcast streams). */
  managedUnsubscribe: boolean;
  /** Sent to a list: Resend broadcasts/audiences, or a loop over subscribers/contacts. */
  toList: boolean;
  /** The name of the function that contains the call, for the classification. */
  functionName?: string;
}

interface ProviderSpec {
  provider: Provider;
  packages: string[];
  match: (callee: string, node: ts.CallExpression | ts.NewExpression, bound: (root: string) => string | undefined) => boolean;
  payloadArg: number;
}

const PROVIDERS: ProviderSpec[] = [
  {
    provider: 'Resend',
    packages: ['resend'],
    match: (c, n) => ts.isCallExpression(n) && /\.(emails\.send|batch\.send|broadcasts\.(create|send))$/.test(c),
    payloadArg: 0,
  },
  {
    provider: 'SendGrid',
    packages: ['@sendgrid/mail'],
    match: (c, n, bound) =>
      ts.isCallExpression(n) && /^[\w$]+\.send(Multiple)?$/.test(c) && (bound(c.split('.')[0]!) === '@sendgrid/mail' || /^(sgMail|sendgrid|sg)$/i.test(c.split('.')[0]!)),
    payloadArg: 0,
  },
  {
    provider: 'Postmark',
    packages: ['postmark'],
    match: (c, n) => ts.isCallExpression(n) && /\.(sendEmail|sendEmailWithTemplate|sendEmailBatch|sendEmailBatchWithTemplates)$/.test(c),
    payloadArg: 0,
  },
  {
    provider: 'Amazon SES',
    packages: ['@aws-sdk/client-ses', '@aws-sdk/client-sesv2', 'aws-sdk'],
    match: (c, n) =>
      (ts.isNewExpression(n) && /^(SendEmailCommand|SendRawEmailCommand|SendTemplatedEmailCommand|SendBulkTemplatedEmailCommand|SendBulkEmailCommand)$/.test(c)) ||
      (ts.isCallExpression(n) && /\.(sendEmail|sendTemplatedEmail)$/.test(c) && /ses/i.test(c)),
    payloadArg: 0,
  },
  {
    provider: 'Mailgun',
    packages: ['mailgun.js', 'mailgun-js'],
    match: (c, n) => ts.isCallExpression(n) && /\.messages\.create$|\.messages\(\)\.send$/.test(c),
    payloadArg: 1,
  },
  {
    provider: 'Nodemailer',
    packages: ['nodemailer'],
    match: (c, n) => ts.isCallExpression(n) && /\.sendMail$/.test(c),
    payloadArg: 0,
  },
];

const SEND_HINT = /\.(emails|batch|broadcasts)\.|\.send(Multiple|Mail|Email\w*)?\s*\(|Send\w*EmailCommand|\.messages\.create/;

function unwrap(expr: ts.Expression | undefined): ts.Expression | undefined {
  let e = expr;
  while (e && (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e))) {
    e = e.expression;
  }
  return e;
}

/** Follows an identifier to its initializer in the same file, through a maximum of a few steps. */
function resolveLocal(expr: ts.Expression | undefined, sf: ts.SourceFile, depth = 2): ts.Expression | undefined {
  const e = unwrap(expr);
  if (!e || !ts.isIdentifier(e) || depth === 0) return e;
  let found: ts.Expression | undefined;
  walk(sf, (n) => {
    if (!found && ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === e.text && n.initializer) found = n.initializer;
  });
  return found ? resolveLocal(found, sf, depth - 1) : e;
}

/** Depth-first search for a property by name (not case-sensitive) in nested object literals. */
function findProp(obj: ts.Expression | undefined, names: string[], depth = 4): ts.Expression | undefined {
  if (!obj || !ts.isObjectLiteralExpression(obj) || depth === 0) return undefined;
  const wanted = names.map((n) => n.toLowerCase());
  for (const p of obj.properties) {
    const name = ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) ? propertyName(p.name)?.toLowerCase() : undefined;
    if (name && wanted.includes(name)) return ts.isPropertyAssignment(p) ? p.initializer : (p as ts.ShorthandPropertyAssignment).name;
  }
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p)) {
      const inner = findProp(unwrap(p.initializer), names, depth - 1);
      if (inner) return inner;
    }
  }
  return undefined;
}

function literalText(expr: ts.Expression | undefined, sf: ts.SourceFile): string | undefined {
  const e = unwrap(expr);
  if (!e) return undefined;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isTemplateExpression(e)) return e.getText(sf).slice(1, -1);
  // SES: { Subject: { Data: '...' } }
  if (ts.isObjectLiteralExpression(e)) return literalText(findProp(e, ['Data'], 1), sf);
  return undefined;
}

/** The name of the component that an expression renders: <X />, X(props), render(<X />), await render(X()). */
function componentName(expr: ts.Expression | undefined, sf: ts.SourceFile, depth = 3): string | undefined {
  const e = resolveLocal(expr, sf);
  if (!e || depth === 0) return undefined;
  if (ts.isJsxElement(e)) return e.openingElement.tagName.getText(sf);
  if (ts.isJsxSelfClosingElement(e)) return e.tagName.getText(sf);
  if (ts.isCallExpression(e)) {
    const callee = e.expression.getText(sf);
    if (/(^|\.)(render|renderAsync|renderToStaticMarkup|renderToString)$/.test(callee)) return componentName(e.arguments[0], sf, depth - 1);
    if (/^[A-Z][\w$]*$/.test(callee)) return callee;
  }
  return undefined;
}

function bodyOf(payload: ts.Expression | undefined, sf: ts.SourceFile): EmailBody {
  const remote = literalText(findProp(payload, ['templateId', 'TemplateAlias', 'TemplateId', 'template', 'Template', 'TemplateName']), sf);
  const reactName = componentName(findProp(payload, ['react']), sf);
  if (reactName) return { kind: 'component', name: reactName };
  const html = findProp(payload, ['html', 'HtmlBody', 'Html', 'text', 'TextBody', 'Text']);
  const inline = literalText(html, sf);
  if (inline !== undefined) return { kind: 'inline', content: inline };
  const htmlComponent = componentName(html, sf);
  if (htmlComponent) return { kind: 'component', name: htmlComponent };
  if (remote) return { kind: 'remote', ref: remote };
  if (findProp(payload, ['templateId', 'TemplateAlias', 'TemplateId', 'template', 'Template', 'TemplateName'])) return { kind: 'remote', ref: '(variable)' };
  return { kind: 'unknown' };
}

const LIST_NAMES = /subscriber|audience|newsletter|contacts|mailing|recipients|members|leads|list/i;

function inLoopOverList(node: ts.Node, sf: ts.SourceFile): boolean {
  for (let n = node.parent; n; n = n.parent) {
    if ((ts.isForOfStatement(n) || ts.isForInStatement(n)) && LIST_NAMES.test(n.expression.getText(sf))) return true;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && /^(map|forEach|flatMap)$/.test(n.expression.name.text)) {
      if (LIST_NAMES.test(n.expression.expression.getText(sf))) return true;
    }
  }
  return false;
}

function enclosingFunctionName(node: ts.Node): string | undefined {
  for (let n = node.parent; n; n = n.parent) {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isFunctionExpression(n)) && n.name) return n.name.getText();
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parent && ts.isVariableDeclaration(n.parent)) return n.parent.name.getText();
  }
  return undefined;
}

const EXTENSIONS = ['', '.tsx', '.ts', '.jsx', '.js', '.mdx', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

/** Resolves an import specifier to a repo file: relative paths, and the usual "@/" and "~/" aliases. */
export function resolveImport(repo: RepoIndex, fromFile: string, specifier: string): string | undefined {
  const files = new Set(repo.files);
  const bases: string[] = [];
  if (specifier.startsWith('.')) bases.push(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier)));
  else if (/^[@~]\//.test(specifier)) bases.push(`src/${specifier.slice(2)}`, specifier.slice(2));
  for (const base of bases) for (const ext of EXTENSIONS) if (files.has(base + ext)) return base + ext;
  return undefined;
}

export async function findEmailSends(repo: RepoIndex): Promise<EmailSend[]> {
  const providers = PROVIDERS.filter((p) => p.packages.some((pkg) => repo.hasDependency(pkg)));
  if (providers.length === 0) return [];
  const sends: EmailSend[] = [];
  for (const file of repo.files) {
    if (fileKind(file) !== 'script' || isNonShippingFile(file)) continue;
    const text = await repo.read(file);
    if (!SEND_HINT.test(text)) continue;
    const sf = await repo.sourceFile(file);
    if (!sf) continue;
    const imports = importsOf(sf);
    const bound = (root: string) => imports.get(root)?.module;
    const map = new LineMap(text);

    walk(sf, (node) => {
      if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return;
      const callee = calleeText(sf, node);
      const spec = providers.find((p) => p.match(callee, node, bound));
      if (!spec) return;
      let payload = resolveLocal(node.arguments?.[spec.payloadArg], sf);
      if (payload && ts.isArrayLiteralExpression(payload)) payload = resolveLocal(payload.elements[0], sf);

      const body = bodyOf(payload, sf);
      if (body.kind === 'component') {
        const binding = imports.get(body.name);
        body.file = binding ? resolveImport(repo, file, binding.module) : file;
      }
      const stream = literalText(findProp(payload, ['MessageStream']), sf) ?? '';
      const range = lineRange(sf, node);
      sends.push({
        file,
        provider: spec.provider,
        label: `${callee}()`,
        ...range,
        snippet: map.snippet(range.startLine, Math.min(range.endLine, range.startLine + 1)),
        callText: node.getText(sf).slice(0, 1500),
        subject: literalText(findProp(payload, ['subject', 'Subject']), sf),
        body,
        managedUnsubscribe:
          /\.broadcasts\./.test(callee) || !!findProp(payload, ['audienceId', 'asm']) || /broadcast/i.test(stream),
        toList: /\.broadcasts\./.test(callee) || !!findProp(payload, ['audienceId']) || inLoopOverList(node, sf),
        functionName: enclosingFunctionName(node),
      });
    });
  }
  return sends;
}

export interface TemplateContent {
  files: string[];
  /** The raw source, for links and placeholders. */
  raw: string;
  /** The text that the reader sees. */
  text: string;
}

/** The content of the email. It includes the template component and the components that it renders, one level deep. */
export async function templateContent(repo: RepoIndex, send: EmailSend): Promise<TemplateContent | null> {
  if (send.body.kind === 'inline') return { files: [], raw: send.body.content, text: markupText(send.body.content) };
  if (send.body.kind !== 'component' || !send.body.file) return null;
  const files = [send.body.file];
  const sf = await repo.sourceFile(send.body.file);
  if (sf) {
    const imports = importsOf(sf);
    walk(sf, (n) => {
      if (!ts.isJsxSelfClosingElement(n) && !ts.isJsxOpeningElement(n)) return;
      const binding = imports.get(n.tagName.getText(sf));
      const resolved = binding && resolveImport(repo, send.body.kind === 'component' ? send.body.file! : send.file, binding.module);
      if (resolved && !files.includes(resolved)) files.push(resolved);
    });
  }
  let raw = '';
  let text = '';
  for (const f of files) {
    const r = await repo.read(f);
    const s = await repo.sourceFile(f);
    raw += `${r}\n`;
    text += `${s ? scriptText(s) : markupText(r)}\n`;
  }
  return { files, raw, text };
}
