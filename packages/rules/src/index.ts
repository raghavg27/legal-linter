import type { Rule } from '@legal-lint/core';
import { ll01 } from './LL-01-google-fonts/index.ts';
import { ll02 } from './LL-02-marketing-email/index.ts';
import { ll03 } from './LL-03-session-replay/index.ts';
import { ll05 } from './LL-05-dmca-agent/index.ts';

export { ll01, ll02, ll03, ll05 };

/** Every shipped rule, in id order. */
export const rules: readonly Rule[] = [ll01, ll02, ll03, ll05];
