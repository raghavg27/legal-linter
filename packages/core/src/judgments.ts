import { createHash } from 'node:crypto';
import type { LegalLintConfig } from './schemas.ts';
import type { JudgmentRequest } from './types.ts';

export type StoredJudgments = NonNullable<LegalLintConfig['judgments']>;

/** Hash of the material a judgment was made on. A stored answer only applies while the material is unchanged. */
export function contentHash(material: JudgmentRequest['material']): string {
  const h = createHash('sha256');
  for (const m of material) h.update(`${m.label}\0${m.file ?? ''}\0${m.content}\0`);
  return h.digest('hex').slice(0, 16);
}
