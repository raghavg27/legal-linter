import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Every test runs licensed by default: a key and a fresh cache in a temporary
// home, so the gate passes without any network call. Tests of the gate build
// their own home. The API URL points at a port nothing listens on, so a test
// that does reach for the network fails instead of calling a real server.
const KEY = 'll_0123456789abcdefghijklmnopqrstuv';
const home = mkdtempSync(path.join(tmpdir(), 'legal-lint-home-'));
writeFileSync(path.join(home, 'key'), `${KEY}\n`);
writeFileSync(
  path.join(home, 'licence.json'),
  JSON.stringify({ keyHash: createHash('sha256').update(KEY).digest('hex'), checkedAt: new Date().toISOString(), expiresAt: null }),
);
process.env.LEGAL_LINT_HOME = home;
process.env.LEGAL_LINT_API_URL = 'http://127.0.0.1:9';
delete process.env.LEGAL_LINT_KEY;
