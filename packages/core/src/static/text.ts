// Comment stripping that keeps every character offset and line number intact:
// commented-out code is replaced with spaces, newlines are kept.

function blank(text: string, start: number, end: number): string {
  return text.slice(0, start) + text.slice(start, end).replace(/[^\n]/g, ' ') + text.slice(end);
}

function blankAll(text: string, pattern: RegExp): string {
  let out = text;
  for (const m of text.matchAll(pattern)) out = blank(out, m.index, m.index + m[0].length);
  return out;
}

export function stripHtmlComments(text: string): string {
  return blankAll(text, /<!--[\s\S]*?(?:-->|$)/g);
}

/**
 * Removes CSS block comments, and `//` line comments for SCSS/Less.
 * Quoted strings are skipped so `url("//host/x")` is not mistaken for a comment.
 */
export function stripCssComments(text: string, lineComments = false): string {
  const pattern = lineComments
    ? /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\/\*[\s\S]*?(?:\*\/|$)|(?<![:\w])\/\/[^\n]*/g
    : /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\/\*[\s\S]*?(?:\*\/|$)/g;
  let out = text;
  for (const m of text.matchAll(pattern)) {
    if (m[0].startsWith('"') || m[0].startsWith("'")) continue;
    out = blank(out, m.index, m.index + m[0].length);
  }
  return out;
}

export class LineMap {
  private readonly starts: number[] = [0];

  constructor(private readonly text: string) {
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') this.starts.push(i + 1);
  }

  /** 1-based line number of a character offset. */
  lineOf(offset: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  /** Source lines startLine..endLine, trimmed and capped for display. */
  snippet(startLine: number, endLine: number, max = 240): string {
    const from = this.starts[startLine - 1] ?? 0;
    const to = this.starts[endLine] ?? this.text.length;
    const s = this.text
      .slice(from, to)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ');
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  }
}
