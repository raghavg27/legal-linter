import { createHash } from 'node:crypto';

/**
 * Stable finding id: derived from the rule and the detector's key (a file or page
 * path), never from line numbers, so unrelated edits don't change it.
 */
export function findingId(ruleId: string, key: string): string {
  const hash = createHash('sha256').update(`${ruleId}\0${key}`).digest('hex').slice(0, 10);
  return `${ruleId}-${hash}`;
}
