import { describe, expect, it } from 'vitest';
import type { EmailSend } from '../shared/email.ts';
import { classify } from './static.ts';

const send = (over: Partial<EmailSend>): EmailSend => ({
  file: 'lib/mail.ts',
  provider: 'Resend',
  label: 'resend.emails.send()',
  startLine: 1,
  endLine: 1,
  snippet: '',
  callText: '',
  body: { kind: 'unknown' },
  managedUnsubscribe: false,
  toList: false,
  ...over,
});

describe('classify', () => {
  it.each([
    [{ subject: 'Your weekly digest' }, 'marketing'],
    [{ subject: 'Spring sale: 20% off' }, 'marketing'],
    [{ body: { kind: 'component', name: 'ProductUpdatesEmail' } }, 'marketing'],
    [{ subject: 'Hello', toList: true }, 'marketing'],
    [{ subject: 'Reset your password' }, 'transactional'],
    [{ subject: 'Your receipt from Acme' }, 'transactional'],
    [{ subject: 'TREK — Test Notification', functionName: 'testSmtp' }, 'transactional'],
    [{ subject: 'Welcome to Acme' }, 'unclear'],
    [{ subject: 'Your order shipped, plus 20% off your next one' }, 'unclear'],
  ] as const)('%o is %s', (over, expected) => {
    expect(classify(send(over as Partial<EmailSend>))).toBe(expected);
  });
});
