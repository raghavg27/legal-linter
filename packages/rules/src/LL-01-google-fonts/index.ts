import { appliesToEuVisitors, defineRule } from '@legal-lint/core';
import fixYaml from './fix.yaml?raw';
import legalYaml from './legal.yaml?raw';
import { detectRuntime } from './runtime.ts';
import { detectStatic } from './static.ts';

export const ll01 = defineRule({
  meta: {
    id: 'LL-01',
    name: "Google Fonts loaded from Google's CDN",
    law: 'GDPR Art. 6(1); LG München I, 3 O 17493/20 (20 Jan 2022)',
    regions: ['EU'],
    phase: 1,
    fixType: 'full',
    detection: ['static', 'runtime'],
    topics: ['fonts', 'google fonts', 'typography', 'web fonts', 'icons', 'material icons', 'landing page', 'theme'],
  },
  legalYaml,
  fixYaml,
  applies: appliesToEuVisitors,
  detectStatic,
  detectRuntime,
});
