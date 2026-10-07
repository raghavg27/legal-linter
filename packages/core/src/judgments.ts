import { createHash } from 'node:crypto';
import { updateConfigFile } from './intake.ts';
import type { LegalLintConfig } from './schemas.ts';
import type { JudgmentRequest } from './types.ts';

export type StoredJudgments = NonNullable<LegalLintConfig['judgments']>;

/** Hash of the material of a judgment. A stored answer applies only while the material does not change. */
export function contentHash(material: JudgmentRequest['material']): string {
  const h = createHash('sha256');
  for (const m of material) h.update(`${m.label}\0${m.file ?? ''}\0${m.content}\0`);
  return h.digest('hex').slice(0, 16);
}

export type StoredJudgment = StoredJudgments[string];

/** Keeps the answer to one judgment question in legal-lint.config.json. */
export function recordJudgment(dir: string, findingId: string, entry: StoredJudgment): Promise<string> {
  return updateConfigFile(dir, (raw) => ({
    ...raw,
    judgments: { ...(raw.judgments as StoredJudgments | undefined), [findingId]: entry },
  }));
}
