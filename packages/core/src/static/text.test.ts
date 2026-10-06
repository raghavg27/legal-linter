import { describe, expect, it } from 'vitest';
import { LineMap, stripCssComments, stripHtmlComments } from './text.ts';

describe('stripHtmlComments', () => {
  it('blanks comments but keeps offsets and newlines', () => {
    const src = 'a\n<!-- <link\nhref="x"> -->\nb';
    const out = stripHtmlComments(src);
    expect(out).toHaveLength(src.length);
    expect(out.split('\n')).toHaveLength(4);
    expect(out).not.toContain('link');
    expect(out.endsWith('\nb')).toBe(true);
  });

  it('blanks an unterminated comment to the end', () => {
    expect(stripHtmlComments('x <!-- open').trim()).toBe('x');
  });
});

describe('stripCssComments', () => {
  it('removes block comments', () => {
    expect(stripCssComments('/* @import url(x); */ a{}').trim()).toBe('a{}');
  });

  it('keeps // inside quoted URLs', () => {
    const src = "@import url('//fonts.googleapis.com/css');";
    expect(stripCssComments(src, true)).toBe(src);
  });

  it('keeps // inside unquoted url() and removes SCSS line comments', () => {
    const src = '@import url(https://fonts.googleapis.com/css);\n// @import "https://x/y";\na{}';
    const out = stripCssComments(src, true);
    expect(out).toContain('url(https://fonts.googleapis.com/css)');
    expect(out).not.toContain('"https://x/y"');
  });
});

describe('LineMap', () => {
  it('maps offsets to 1-based lines', () => {
    const map = new LineMap('ab\ncd\n\nef');
    expect(map.lineOf(0)).toBe(1);
    expect(map.lineOf(3)).toBe(2);
    expect(map.lineOf(6)).toBe(3);
    expect(map.lineOf(7)).toBe(4);
  });

  it('builds a trimmed single-line snippet', () => {
    const map = new LineMap('  <link\n    href="x"\n  />\nnext');
    expect(map.snippet(1, 3)).toBe('<link href="x" />');
  });
});

describe('stripCssComments with SCSS line comments', () => {
  it('keeps protocol-relative unquoted url(//...)', () => {
    const src = '@import url(//fonts.googleapis.com/css2?family=Inter);';
    expect(stripCssComments(src, true)).toBe(src);
  });
});
