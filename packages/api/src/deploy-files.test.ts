import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The cost limits live in these files. A change that loosens one should fail a test, not show up on a bill.
const dir = path.resolve(import.meta.dirname, '..');
const read = (f: string) => readFileSync(path.join(dir, f), 'utf8');
const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };

describe('deploy files', () => {
  it('the image installs the same Playwright and Firestore versions as package.json', () => {
    const docker = read('Dockerfile');
    expect(docker).toContain(`playwright@${pkg.dependencies.playwright}`);
    expect(docker).toContain(`@google-cloud/firestore@${pkg.dependencies['@google-cloud/firestore']}`);
    expect(docker).toContain('--only-shell');
  });

  it('deploys with the free-tier limits', () => {
    const deploy = read('deploy.sh');
    for (const flag of ['--max-instances 1', '--min-instances 0', '--cpu 1', '--memory 2Gi', '--timeout 120', '--cpu-throttling', '--region "$REGION"']) {
      expect(deploy).toContain(flag);
    }
    expect(deploy).toContain('REGION=us-central1');
  });

  it('keeps only the latest image', () => {
    expect(JSON.parse(read('cleanup-policy.json'))).toEqual([
      { name: 'keep-latest', action: { type: 'Keep' }, mostRecentVersions: { keepCount: 1 } },
      { name: 'delete-older', action: { type: 'Delete' }, condition: { tagState: 'any' } },
    ]);
  });
});
