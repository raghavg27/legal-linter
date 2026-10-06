import { defineRule } from '@legal-lint/core';
import { appliesToUsVisitors } from '../shared/applicability.ts';
import fixYaml from './fix.yaml?raw';
import legalYaml from './legal.yaml?raw';
import { detectRuntime } from './runtime.ts';
import { detectStatic } from './static.ts';

export const ll03 = defineRule({
  meta: {
    id: 'LL-03',
    name: 'Session replay recording before consent',
    law: 'California Invasion of Privacy Act, Penal Code §631, §637.2',
    regions: ['US'],
    phase: 1,
    fixType: 'full',
    detection: ['static', 'runtime'],
    topics: [
      'session replay',
      'session recording',
      'analytics',
      'heatmaps',
      'hotjar',
      'fullstory',
      'logrocket',
      'clarity',
      'posthog',
      'user tracking',
      'product analytics',
    ],
  },
  legalYaml,
  fixYaml,
  applies: (intake) => appliesToUsVisitors(intake, 'California visitors'),
  detectStatic,
  detectRuntime,
});
