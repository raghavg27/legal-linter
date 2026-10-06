import type { Rule } from '@legal-lint/core';
import { ll01 } from './LL-01-google-fonts/index.ts';

export { ll01 };

/** Every shipped rule, in id order. */
export const rules: readonly Rule[] = [ll01];
