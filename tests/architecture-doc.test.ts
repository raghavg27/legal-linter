import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// docs/architecture.md names the file that owns each diagram. When a file is
// renamed or deleted, this fails, so the diagrams cannot quietly point at code that is gone.

const root = path.resolve(import.meta.dirname, '..');
const doc = readFileSync(path.join(root, 'docs/architecture.md'), 'utf8');

/** "core/src/engine.ts" is short for packages/core/src/engine.ts; other paths are from the repo root. */
function resolve(ref: string): string {
  return /^(api|cli|core|rules)\/src\//.test(ref) ? path.join(root, 'packages', ref) : path.join(root, ref);
}

const refs = [
  ...new Set(
    [...doc.matchAll(/(?<![\w./-])((?:(?:api|cli|core|rules)\/src|packages|tests|docs)\/[\w./-]+\.(?:ts|md|json|yaml)|[A-Z_]+\.md)\b/g)].map((m) => m[1]!),
  ),
];

describe('architecture diagrams', () => {
  it('name some files', () => {
    expect(refs.length).toBeGreaterThan(10);
  });

  for (const ref of refs) {
    it(`${ref} exists`, () => {
      expect(existsSync(resolve(ref)), `docs/architecture.md mentions ${ref}, which does not exist. Update the diagram.`).toBe(true);
    });
  }
});
