import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRepoIndex } from './repo-index.ts';
import { listRoutes } from './routes.ts';

async function repoWith(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), 'legal-lint-routes-'));
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  return buildRepoIndex(root);
}

describe('listRoutes', () => {
  it('maps framework file layouts and server registrations to URL paths', async () => {
    const repo = await repoWith({
      'app/(marketing)/pricing/page.tsx': '',
      'src/app/api/billing/portal/route.ts': '',
      'app/page.tsx': '',
      'pages/dmca.tsx': '',
      'pages/api/unsubscribe.ts': '',
      'pages/_app.tsx': '',
      'app/routes/settings.billing.tsx': '',
      'src/routes/legal/copyright/+page.svelte': '',
      'public/terms.html': '',
      'server/index.js': "app.get('/unsubscribe', handler);\nrouter.post(`/billing/cancel`, cancel);\nfetch('/api/x');",
      'tests/e2e.ts': "app.get('/ignored', h);",
    });
    const routes = (await listRoutes(repo)).map((r) => `${r.kind} ${r.path}`).sort();
    expect(routes).toEqual([
      'api /api/billing/portal',
      'api /api/unsubscribe',
      'page /',
      'page /dmca',
      'page /legal/copyright',
      'page /pricing',
      'page /settings/billing',
      'page /terms',
      'server /billing/cancel',
      'server /unsubscribe',
    ]);
  });
});
