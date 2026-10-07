import { defineRule } from '@legal-lint/core';
import { appliesWithFlag } from '../shared/applicability.ts';
import fixYaml from './fix.yaml?raw';
import legalYaml from './legal.yaml?raw';
import { detectStatic } from './static.ts';

export const ll02 = defineRule({
  meta: {
    id: 'LL-02',
    name: 'Marketing email with no unsubscribe or postal address',
    law: 'CAN-SPAM Act, 15 U.S.C. §7704',
    regions: ['US'],
    phase: 1,
    fixType: 'full',
    detection: ['static'],
    topics: [
      'email',
      'newsletter',
      'newsletter signup',
      'marketing email',
      'email campaigns',
      'drip emails',
      'onboarding emails',
      'resend',
      'sendgrid',
      'postmark',
      'mailgun',
      'ses',
      'nodemailer',
      'waitlist',
    ],
    notTopics: ['email address', 'email field', 'email input', 'email validation', 'email login', 'email verification'],
  },
  legalYaml,
  fixYaml,
  applies: (intake) =>
    appliesWithFlag(intake, 'sendsMarketingEmail', 'sends marketing email', 'does not send marketing email', 'US recipients'),
  detectStatic,
});
