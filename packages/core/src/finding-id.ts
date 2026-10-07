import { createHash } from 'node:crypto';

/**
 * Stable finding id: it comes from the rule and the key of the detector (a file
 * or page path), never from line numbers. Thus edits that are not related do not
 * change it.
 */
export function findingId(ruleId: string, key: string): string {
  const hash = createHash('sha256').update(`${ruleId}\0${key}`).digest('hex').slice(0, 10);
  return `${ruleId}-${hash}`;
}
