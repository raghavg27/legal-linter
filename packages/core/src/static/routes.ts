import ts from 'typescript';
import type { RepoIndex } from '../types.ts';
import { isNonShippingFile } from './file-kinds.ts';
import { walk } from './ast.ts';

export interface RouteInfo {
  /** URL path, for example "/unsubscribe" or "/api/billing/portal". Dynamic segments stay as written: "/u/[id]". */
  path: string;
  file: string;
  kind: 'page' | 'api' | 'server';
  /** The line of a server route registration (Express, Hono, Fastify). The first line is 1. */
  line?: number;
}

const PAGE_EXT = /\.(tsx|jsx|ts|js|mdx|md|svelte|astro|vue|html?)$/;

function cleanSegments(segments: string[]): string {
  const kept = segments.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@') && s !== 'index');
  return `/${kept.join('/')}`.replace(/\/+$/, '') || '/';
}

/** Routes that the file layout gives: Next.js app and pages routers, Remix, SvelteKit, Astro, Nuxt, static HTML. */
function fileRoutes(file: string): RouteInfo | null {
  if (!PAGE_EXT.test(file) || isNonShippingFile(file)) return null;
  let m: RegExpExecArray | null;

  if ((m = /^(?:.*\/)?(?:src\/)?app\/(.*?)\/?(page|route)\.(tsx|jsx|ts|js|mdx|md)$/.exec(file)) && !file.includes('/routes/')) {
    const segments = m[1] ? m[1].split('/') : [];
    return { path: cleanSegments(segments), file, kind: m[2] === 'route' ? 'api' : 'page' };
  }
  if ((m = /^(?:.*\/)?(?:src\/)?pages\/(.*)\.(tsx|jsx|ts|js|mdx|md|astro|vue)$/.exec(file))) {
    if (/(^|\/)_(app|document|error)$/.test(m[1]!)) return null;
    const path = cleanSegments(m[1]!.split('/'));
    return { path, file, kind: path.startsWith('/api/') || path === '/api' ? 'api' : 'page' };
  }
  if ((m = /^(?:.*\/)?app\/routes\/(.*)\.(tsx|jsx|ts|js)$/.exec(file))) {
    // Remix / React Router flat routes: "billing.cancel.tsx" → /billing/cancel, "_index" → /
    const segments = m[1]!.replace(/\/route$/, '').split(/[./]/).filter((s) => s && !s.startsWith('_'));
    const path = cleanSegments(segments);
    return { path, file, kind: /^api\b/.test(m[1]!) || /\.(ts|js)$/.test(file) ? 'api' : 'page' };
  }
  if ((m = /^(?:.*\/)?src\/routes\/(.*?)\/?\+(page|server)\.(svelte|ts|js)$/.exec(file))) {
    return { path: cleanSegments(m[1] ? m[1].split('/') : []), file, kind: m[2] === 'server' ? 'api' : 'page' };
  }
  if (/\.html?$/.test(file)) {
    const path = cleanSegments(file.replace(/^(public|static|www|site)\//, '').replace(/\.html?$/, '').split('/'));
    return { path, file, kind: 'page' };
  }
  return null;
}

const SERVER_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'use', 'route']);

/** Registrations in the Express style: app.get('/unsubscribe', ...), router.post('/billing/cancel', ...). */
function serverRoutes(file: string, sf: ts.SourceFile): RouteInfo[] {
  const out: RouteInfo[] = [];
  walk(sf, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    if (!SERVER_METHODS.has(node.expression.name.text)) return;
    const arg = node.arguments[0];
    if (!arg || !(ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) || !arg.text.startsWith('/')) return;
    if (node.arguments.length < 2 && node.expression.name.text !== 'route') return;
    out.push({ path: arg.text, file, kind: 'server', line: sf.getLineAndCharacterOfPosition(arg.getStart(sf)).line + 1 });
  });
  return out;
}

export async function listRoutes(repo: RepoIndex): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];
  for (const file of repo.files) {
    const r = fileRoutes(file);
    if (r) routes.push(r);
    if (/\.(m|c)?[jt]s$/.test(file) && !isNonShippingFile(file)) {
      const text = await repo.read(file);
      if (!/\.(get|post|put|patch|delete|all|use|route)\(\s*['"`]\//.test(text)) continue;
      const sf = await repo.sourceFile(file);
      if (sf) routes.push(...serverRoutes(file, sf));
    }
  }
  return routes;
}
