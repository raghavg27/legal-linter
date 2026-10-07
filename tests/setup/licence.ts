import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// By default, each test runs with a licence: a key and a new cache in a temporary
// home. Thus the gate passes without a network call. The tests of the gate make
// their own home. The API URL points to a port where no server listens. Thus, if a test
// tries to use the network, it fails. It does not call a real server.
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
