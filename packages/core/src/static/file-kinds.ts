// How detectors decide which files to read and how.

export type FileKind = 'script' | 'css' | 'scss' | 'markup' | 'other';

const MARKUP = /\.(html?|vue|svelte|astro|ejs|hbs|handlebars|liquid|njk)$/i;
const SCRIPT = /\.(m|c)?[jt]sx?$/i;

export function fileKind(file: string): FileKind {
  if (/\.d\.[mc]?ts$/i.test(file)) return 'other';
  if (SCRIPT.test(file)) return 'script';
  if (/\.css$/i.test(file)) return 'css';
  if (/\.(scss|sass|less)$/i.test(file)) return 'scss';
  if (MARKUP.test(file)) return 'markup';
  return 'other';
}

/**
 * Files that never reach a visitor's browser: tests, stories, fixtures and
 * minified vendor bundles. A font URL in a test assertion is not a font load.
 */
export function isNonShippingFile(file: string): boolean {
  return (
    /(^|\/)(__tests__|__mocks__|tests?|e2e|cypress|fixtures|__fixtures__|stories)\//i.test(file) ||
    /\.(test|spec|stories|story|cy)\.[mc]?[jt]sx?$/i.test(file) ||
    /(^|\/)tests?[-_][^/]*\.[mc]?[jt]sx?$/i.test(file) ||
    /[-_](test|spec)\.[mc]?[jt]sx?$/i.test(file) ||
    /\.min\.(js|css)$/i.test(file)
  );
}
