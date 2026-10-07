import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXTURES_DIR } from './helpers/fixtures.ts';

// End to end: the published binary, started in the same way as a coding agent starts it
// (`legal-lint mcp` in the project folder), with communication over real stdio.

const REPO = path.resolve(import.meta.dirname, '..');
const BIN = path.join(REPO, 'packages', 'cli', 'dist', 'bin.js');

interface Rpc {
  jsonrpc: string;
  id?: number;
  result?: Record<string, any>;
  error?: unknown;
}

async function session(cwd: string, protocolVersion: string, requests: { method: string; params?: unknown }[]) {
  const child = spawn(process.execPath, [BIN, 'mcp'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const lines: string[] = [];
  const responses = new Map<number, Rpc>();
  const lastId = requests.length + 1;
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out; stderr: ${stderr}`)), 20_000);
    createInterface({ input: child.stdout }).on('line', (line) => {
      lines.push(line);
      const msg = JSON.parse(line) as Rpc;
      if (msg.id !== undefined) responses.set(msg.id, msg);
      if (responses.has(lastId)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  const send = (m: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
  send({ id: 1, method: 'initialize', params: { protocolVersion, capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } });
  send({ method: 'notifications/initialized' });
  requests.forEach((r, i) => send({ id: i + 2, ...r }));
  await done;
  child.stdin.end();
  await new Promise((resolve) => child.on('exit', resolve));
  return { lines, responses, stderr, exitCode: child.exitCode };
}

describe('legal-lint mcp over stdio', () => {
  beforeAll(() => {
    execFileSync('pnpm', ['--filter', 'legal-lint', 'build'], { cwd: REPO, stdio: 'ignore' });
  }, 60_000);

  for (const protocolVersion of ['2025-06-18', '2025-11-25']) {
    it(`handshakes at ${protocolVersion}, scans the folder it was started in, and writes only protocol messages to stdout`, async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'legal-lint-stdio-'));
      await cp(path.join(FIXTURES_DIR, 'LL-01', 'fires-next-pages-document'), dir, { recursive: true });

      const { lines, responses, stderr, exitCode } = await session(dir, protocolVersion, [
        { method: 'tools/list' },
        { method: 'tools/call', params: { name: 'scan_repo', arguments: {} } },
      ]);

      // Each stdout line is a JSON-RPC message. One unexpected log line would break the host.
      for (const line of lines) expect(JSON.parse(line).jsonrpc).toBe('2.0');
      expect(stderr).toBe('');
      expect(exitCode).toBe(0);

      expect(responses.get(1)!.result).toMatchObject({ protocolVersion, serverInfo: { name: 'legal-lint' } });
      expect(responses.get(2)!.result!.tools).toHaveLength(7);
      const scan = responses.get(3)!.result!;
      expect(scan.isError).toBeFalsy();
      expect(scan.structuredContent.target).toMatchObject({ kind: 'repo', root: await realpath(dir) });
      expect(scan.structuredContent.summary).toEqual({ open: 1, needsJudgment: 0, needsIntake: 0 });
    });
  }
});
