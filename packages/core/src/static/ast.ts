import ts from 'typescript';

// Syntax trees only: one createSourceFile per file, no Program and no type checker.
// That is enough to tell code from comments and strings, and keeps scans fast.

const SCRIPT_KINDS: Record<string, ts.ScriptKind> = {
  '.ts': ts.ScriptKind.TS,
  '.mts': ts.ScriptKind.TS,
  '.cts': ts.ScriptKind.TS,
  '.tsx': ts.ScriptKind.TSX,
  '.js': ts.ScriptKind.JS,
  '.mjs': ts.ScriptKind.JS,
  '.cjs': ts.ScriptKind.JS,
  '.jsx': ts.ScriptKind.JSX,
};

export function scriptKindOf(file: string): ts.ScriptKind | undefined {
  const dot = file.lastIndexOf('.');
  return dot === -1 ? undefined : SCRIPT_KINDS[file.slice(dot)];
}

export function parseSource(file: string, text: string): ts.SourceFile | null {
  const kind = scriptKindOf(file);
  if (kind === undefined) return null;
  // .js files often contain JSX (Create React App, older Next.js), so parse them as JSX.
  const effective = kind === ts.ScriptKind.JS ? ts.ScriptKind.JSX : kind;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, effective);
}

export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/** 1-based start and end lines of a node, excluding leading trivia. */
export function lineRange(sf: ts.SourceFile, node: ts.Node): { startLine: number; endLine: number } {
  return {
    startLine: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
    endLine: sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
  };
}

/** The literal value of a JSX attribute, when it is a plain string: href="x", href={'x'} or href={`x`}. */
export function jsxAttributeString(
  attributes: ts.JsxAttributes,
  name: string,
): { value: string; node: ts.Node } | undefined {
  for (const prop of attributes.properties) {
    if (!ts.isJsxAttribute(prop) || prop.name.getText() !== name || !prop.initializer) continue;
    const init = prop.initializer;
    if (ts.isStringLiteral(init)) return { value: init.text, node: init };
    if (ts.isJsxExpression(init) && init.expression) {
      const e = init.expression;
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return { value: e.text, node: e };
    }
  }
  return undefined;
}

export { ts };
