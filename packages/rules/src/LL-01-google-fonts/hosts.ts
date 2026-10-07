export const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

export interface FontUrl {
  index: number;
  length: number;
  host: string;
  path: string;
}

// Needs a scheme or a protocol-relative "//". Thus text such as "we stopped using
// fonts.googleapis.com" is never read as a URL.
const FONT_URL = /(?:https?:)?\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)(?![\w.-])([^\s"'`)<>\\]*)/gi;

export function findFontUrls(text: string): FontUrl[] {
  return Array.from(text.matchAll(FONT_URL), (m) => ({
    index: m.index,
    length: m[0].length,
    host: m[1]!.toLowerCase(),
    path: m[2] ?? '',
  }));
}

/**
 * A URL that really gets a font or a font stylesheet. Not a host without a path
 * (for example, in a Content-Security-Policy string).
 */
export function isFontAssetUrl(url: FontUrl): boolean {
  return url.host === 'fonts.googleapis.com' ? /^\/(css2?|icon)\b/i.test(url.path) : /^\/s\//i.test(url.path);
}

export type LinkEffect = 'load' | 'preconnect' | null;

/** What a <link> with this rel does with its href. dns-prefetch only resolves a name. Thus it sends nothing to Google. */
export function linkEffect(rel: string | undefined): LinkEffect {
  const rels = (rel ?? '').toLowerCase().split(/\s+/);
  if (rels.some((r) => r === 'stylesheet' || r === 'preload' || r === 'prefetch')) return 'load';
  if (rels.includes('preconnect')) return 'preconnect';
  return null;
}
