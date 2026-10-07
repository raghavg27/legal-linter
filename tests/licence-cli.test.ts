import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT, run } from '../packages/cli/src/program.ts';
import type { RuntimeEnv } from '../packages/cli/src/licence/store.ts';
import { FIXTURES_DIR } from './helpers/fixtures.ts';
import { fakeFetch, json, makeHome, TEST_KEY } from './helpers/licence.ts';

async function cli(rt: RuntimeEnv, ...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, { stdout: { write: (s: string) => (stdout += s), isTTY: false }, stderr: { write: (s: string) => (stderr += s) } }, rt);
  return { code, stdout, stderr };
}

const fixture = path.join(FIXTURES_DIR, 'LL-01', 'fires-vite-css-import');
const keyless = async (): Promise<RuntimeEnv> => ({
  env: { LEGAL_LINT_HOME: await makeHome({ key: null, checkedAt: null }), LEGAL_LINT_API_URL: 'https://api.test' },
  fetch: fakeFetch(() => json(500, {})),
  now: () => new Date(),
});

describe('CLI without a key', () => {
  it('scan and scan-url exit 2 with directions and print no findings', async () => {
    const rt = await keyless();
    for (const argv of [['scan', fixture], ['scan-url', 'https://example.com/']]) {
      const { code, stdout, stderr } = await cli(rt, ...argv);
      expect(code, argv[0]).toBe(EXIT.error);
      expect(stdout).toBe('');
      expect(stderr).toMatch(/needs a licence key.*LEGAL_LINT_KEY.*legal-lint activate/);
    }
  });

  it('help, version and init still work', async () => {
    const rt = await keyless();
    expect((await cli(rt, '--version')).code).toBe(EXIT.clean);
    expect((await cli(rt, '--help')).code).toBe(EXIT.clean);
    const dir = await mkdtemp(path.join(tmpdir(), 'legal-lint-init-'));
    expect((await cli(rt, 'init', dir, '--answers', '{"euUkVisitors":true}')).code).toBe(EXIT.clean);
  });
});

describe('activate and licence', () => {
  it('activate saves a valid key, and licence reports it masked', async () => {
    const home = await makeHome({ key: null, checkedAt: null });
    const rt: RuntimeEnv = { env: { LEGAL_LINT_HOME: home, LEGAL_LINT_API_URL: 'https://api.test' }, fetch: fakeFetch(() => json(200, { valid: true, expiresAt: null })), now: () => new Date() };
    const act = await cli(rt, 'activate', TEST_KEY);
    expect(act.code).toBe(EXIT.clean);
    expect(act.stdout).toContain(path.join(home, 'key'));
    expect(act.stdout).not.toContain(TEST_KEY);
    const status = await cli(rt, 'licence');
    expect(status.code).toBe(EXIT.clean);
    expect(status.stdout).toMatch(/ll_01234….*saved key/s);
    expect(status.stdout).not.toContain(TEST_KEY);
    expect((await cli(rt, 'scan', fixture)).code).toBe(EXIT.findings);
  });

  it('licence exits 2 and explains when there is no key', async () => {
    const { code, stdout } = await cli(await keyless(), 'licence');
    expect(code).toBe(EXIT.error);
    expect(stdout).toMatch(/needs a licence key/);
  });

  it('prints the grace warning on stderr and still scans', async () => {
    const rt: RuntimeEnv = {
      env: { LEGAL_LINT_HOME: await makeHome({ checkedAt: new Date(Date.now() - 2 * 86_400_000) }), LEGAL_LINT_API_URL: 'https://api.test' },
      fetch: fakeFetch(() => Promise.reject(new Error('offline'))),
      now: () => new Date(),
    };
    const { code, stderr } = await cli(rt, 'scan', fixture, '--json');
    expect(code).toBe(EXIT.findings);
    expect(stderr).toMatch(/Could not reach the licence server/);
  });

  it('refuses a licenceKey in the project config with directions', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'legal-lint-cfg-'));
    await writeFile(path.join(dir, 'legal-lint.config.json'), JSON.stringify({ licenceKey: TEST_KEY }));
    const { code, stderr } = await cli({ env: process.env, fetch: fakeFetch(() => json(500, {})), now: () => new Date() }, 'scan', dir);
    expect(code).toBe(EXIT.error);
    expect(stderr).toMatch(/Remove licenceKey/);
  });
});
