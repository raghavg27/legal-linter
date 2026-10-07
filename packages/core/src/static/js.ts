import ts from 'typescript';

// Small AST helpers that the detectors share.

export interface ImportBinding {
  module: string;
  /** "default", "*" for a namespace import, or the imported name. */
  imported: string;
}

/** Local name → module, for ES imports and `const x = require('m')`. */
export function importsOf(sf: ts.SourceFile): Map<string, ImportBinding> {
  const out = new Map<string, ImportBinding>();
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const module = stmt.moduleSpecifier.text;
      const clause = stmt.importClause;
      if (clause?.name) out.set(clause.name.text, { module, imported: 'default' });
      const nb = clause?.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) out.set(nb.name.text, { module, imported: '*' });
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) out.set(el.name.text, { module, imported: (el.propertyName ?? el.name).text });
      }
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        const init = decl.initializer;
        if (!init || !ts.isCallExpression(init) || init.expression.getText(sf) !== 'require') continue;
        const arg = init.arguments[0];
        if (!arg || !ts.isStringLiteral(arg)) continue;
        if (ts.isIdentifier(decl.name)) out.set(decl.name.text, { module: arg.text, imported: 'default' });
        if (ts.isObjectBindingPattern(decl.name)) {
          for (const el of decl.name.elements) {
            if (ts.isIdentifier(el.name)) {
              const prop = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
              out.set(el.name.text, { module: arg.text, imported: prop });
            }
          }
        }
      }
    }
  }
  return out;
}

/** The source text of the callee of a call, without whitespace, for example "resend.emails.send". */
export function calleeText(sf: ts.SourceFile, call: ts.CallExpression | ts.NewExpression): string {
  return call.expression.getText(sf).replace(/\s+/g, '').replace(/\?\./g, '.');
}

export function* ancestors(node: ts.Node): Generator<ts.Node> {
  for (let n = node.parent; n; n = n.parent) yield n;
}

export function propertyName(name: ts.PropertyName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

/** The initializer of a property in an object literal (shorthand `{ html }` returns the identifier). */
export function objectProp(obj: ts.Expression | undefined, name: string): ts.Expression | undefined {
  if (!obj || !ts.isObjectLiteralExpression(obj)) return undefined;
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && propertyName(p.name) === name) return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) return p.name;
  }
  return undefined;
}

export function stringValue(expr: ts.Expression | undefined): string | undefined {
  if (!expr) return undefined;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  if (ts.isTemplateExpression(expr)) return [expr.head.text, ...expr.templateSpans.map((s) => `\${…}${s.literal.text}`)].join('');
  return undefined;
}

export function isTruthyLiteral(expr: ts.Expression | undefined): boolean {
  return !!expr && expr.kind === ts.SyntaxKind.TrueKeyword;
}

/**
 * Approximately the text that a reader of the rendered UI or email sees: JSX text
 * and string literals, with spaces between them. Import paths and comments are not included.
 */
export function scriptText(sf: ts.SourceFile): string {
  const parts: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxText(node)) {
      const t = node.text.replace(/\s+/g, ' ').trim();
      if (t) parts.push(t);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      parts.push(node.text);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      parts.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return parts.join(' ');
}

/** The visible text of an HTML-like file, without tags, comments, scripts and styles. */
export function markupText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
