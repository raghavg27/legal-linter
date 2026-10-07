import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import type ts from 'typescript';
import type { Framework, PackageInfo, RepoIndex } from '../types.ts';
import { parseSource } from './ast.ts';

/** Never scanned: dependencies, VCS data and build output. */
const ALWAYS_SKIPPED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.vercel',
  '.netlify',
  '.turbo',
  '.output',
  '.cache',
  'dist',
  'build',
  'out',
  'coverage',
  // The HTML reports of Legal Lint, which contain quotes of the findings.
  '.legal-lint',
]);

const MAX_FILE_BYTES = 1_000_000;

interface IgnoreScope {
  base: string;
  ig: Ignore;
}

async function readIgnore(dir: string): Promise<Ignore | null> {
  try {
    return ignore().add(await readFile(path.join(dir, '.gitignore'), 'utf8'));
  } catch {
    return null;
  }
}

function isIgnored(rel: string, isDir: boolean, scopes: IgnoreScope[]): boolean {
  for (const { base, ig } of scopes) {
    const sub = base ? path.posix.relative(base, rel) : rel;
    if (sub && !sub.startsWith('..') && ig.ignores(isDir ? `${sub}/` : sub)) return true;
  }
  return false;
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(relDir: string, scopes: IgnoreScope[]): Promise<void> {
    const abs = path.join(root, relDir);
    const local = await readIgnore(abs);
    const here = local ? [...scopes, { base: relDir, ig: local }] : scopes;
    const entries = await readdir(abs, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (ALWAYS_SKIPPED_DIRS.has(e.name) || isIgnored(rel, true, here)) continue;
        await visit(rel, here);
      } else if (e.isFile() && !isIgnored(rel, false, here)) {
        out.push(rel);
      }
    }
  }
  await visit('', []);
  return out;
}

async function readPackages(root: string, files: string[]): Promise<PackageInfo[]> {
  const pkgs: PackageInfo[] = [];
  for (const f of files.filter((f) => f === 'package.json' || f.endsWith('/package.json'))) {
    try {
      const json = JSON.parse(await readFile(path.join(root, f), 'utf8')) as Record<string, unknown>;
      pkgs.push({
        dir: path.posix.dirname(f) === '.' ? '' : path.posix.dirname(f),
        name: typeof json.name === 'string' ? json.name : undefined,
        dependencies: (json.dependencies as Record<string, string>) ?? {},
        devDependencies: (json.devDependencies as Record<string, string>) ?? {},
      });
    } catch {
      // A broken package.json is not ours to report.
    }
  }
  return pkgs;
}

function detectFrameworks(files: readonly string[], has: (name: string) => boolean): Framework[] {
  const found: Framework[] = [];
  const under = (dir: string) => files.some((f) => new RegExp(`(^|/)(src/)?${dir}/`).test(f));
  if (has('next')) {
    if (files.some((f) => /(^|\/)(src\/)?app\/layout\.[jt]sx?$/.test(f))) found.push('next-app');
    if (under('pages')) found.push('next-pages');
    if (found.length === 0) found.push('next-pages');
  }
  if (has('@remix-run/react') || has('@remix-run/node') || (has('react-router') && has('@react-router/dev'))) {
    found.push('remix');
  }
  if (has('vite') && has('react') && !has('next')) found.push('vite-react');
  if (found.length === 0 && (has('express') || has('fastify') || has('hono') || has('koa'))) {
    found.push('node-server');
  }
  if (found.length === 0 && files.some((f) => /\.html?$/.test(f))) found.push('plain-html');
  return found;
}

export async function buildRepoIndex(root: string): Promise<RepoIndex> {
  const absRoot = path.resolve(root);
  const isDir = await stat(absRoot).then((s) => s.isDirectory(), () => false);
  if (!isDir) throw new Error(`Not a directory: ${root}`);

  const files = await listFiles(absRoot);
  const packages = await readPackages(absRoot, files);
  const hasDependency = (name: string) =>
    packages.some((p) => name in p.dependencies || name in p.devDependencies);

  const textCache = new Map<string, Promise<string>>();
  const astCache = new Map<string, Promise<ts.SourceFile | null>>();

  const read = (file: string): Promise<string> => {
    let p = textCache.get(file);
    if (!p) {
      p = (async () => {
        const abs = path.join(absRoot, file);
        if ((await stat(abs)).size > MAX_FILE_BYTES) return '';
        return readFile(abs, 'utf8');
      })();
      textCache.set(file, p);
    }
    return p;
  };

  const sourceFile = (file: string): Promise<ts.SourceFile | null> => {
    let p = astCache.get(file);
    if (!p) {
      p = read(file).then((text) => parseSource(file, text));
      astCache.set(file, p);
    }
    return p;
  };

  return {
    root: absRoot,
    files,
    read,
    sourceFile,
    packages,
    hasDependency,
    frameworks: detectFrameworks(files, hasDependency),
  };
}
