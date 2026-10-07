import { defineRule } from '@legal-lint/core';
import { appliesWithFlag } from '../shared/applicability.ts';
import fixYaml from './fix.yaml?raw';
import legalYaml from './legal.yaml?raw';
import { detectRuntime } from './runtime.ts';
import { detectStatic } from './static.ts';

export const ll04 = defineRule({
  meta: {
    id: 'LL-04',
    name: 'Subscription that renews silently',
    law: 'California Automatic Renewal Law, Bus. & Prof. Code §17600 ff. (amended by AB 2863, effective 1 Jul 2025)',
    regions: ['US'],
    phase: 1,
    fixType: 'partial',
    detection: ['static', 'runtime'],
    topics: [
      'payments',
      'subscriptions',
      'stripe subscriptions',
      'stripe checkout',
      'billing',
      'pricing page',
      'paywall',
      'free trial',
      'paddle',
      'lemon squeezy',
      'razorpay',
      'recurring billing',
      'saas plans',
    ],
  },
  legalYaml,
  fixYaml,
  applies: (intake) =>
    appliesWithFlag(intake, 'sellsSubscriptions', 'sells subscriptions', 'does not sell subscriptions', 'California consumers'),
  detectStatic,
  detectRuntime,
});
