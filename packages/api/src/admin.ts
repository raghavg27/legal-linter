import { parseArgs } from 'node:util';
import { issueKey } from './keys.ts';
import type { KeyStore } from './store.ts';

const USAGE = `Usage:
  admin issue --label <who it is for> [--expires YYYY-MM-DD]
  admin list
  admin revoke <key prefix, e.g. ll_AbC12>
`;

/** Issues, lists and revokes licence keys. Returns an exit code. */
export async function admin(argv: string[], store: KeyStore, out: (s: string) => void, now = new Date()): Promise<number> {
  const usage = (problem?: string) => {
    out(`${problem ? `${problem}\n\n` : ''}${USAGE}`);
    return 2;
  };
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { label: { type: 'string' }, expires: { type: 'string' } } });
  } catch (e) {
    return usage((e as Error).message);
  }
  const [command, arg] = parsed.positionals;
  const { label, expires } = parsed.values;

  if (command === 'issue') {
    if (!label) return usage('issue needs --label.');
    if (expires !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return usage('--expires must be YYYY-MM-DD.');
    const expiresAt = expires ? new Date(`${expires}T00:00:00Z`).toISOString() : null;
    const { key, hash, record } = issueKey(label, expiresAt, now);
    await store.put(hash, record);
    out(`Key for ${label}. It is shown only now; send it to them and do not keep a copy:\n\n  ${key}\n\nPrefix ${record.prefix}, expires ${expires ? `${expires} 00:00 UTC` : 'never'}.\n`);
    return 0;
  }
  if (command === 'list') {
    const keys = await store.list();
    if (keys.length === 0) out('No keys.\n');
    for (const k of keys) {
      const status = k.revokedAt ? 'revoked' : k.expiresAt && Date.parse(k.expiresAt) <= now.getTime() ? 'expired' : 'active';
      out(`${k.prefix}  ${k.label}  created ${k.createdAt.slice(0, 10)}  expires ${k.expiresAt?.slice(0, 10) ?? 'never'}  ${status}\n`);
    }
    return 0;
  }
  if (command === 'revoke') {
    if (!arg) return usage('revoke needs a key prefix.');
    const n = await store.revoke(arg, now);
    out(`Revoked ${n} key${n === 1 ? '' : 's'} with prefix ${arg}.\n`);
    return n > 0 ? 0 : 1;
  }
  return usage(command ? `Unknown command: ${command}` : undefined);
}
