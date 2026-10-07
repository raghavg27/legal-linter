import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rules } from '@legal-lint/rules';
import { loadFixtures } from './helpers/fixtures.ts';

// Tests about the fixtures: a rule is only as good as the fixtures that prove it.
const fixtures = loadFixtures();

describe('fixture coverage', () => {
  for (const rule of rules) {
    const modes = rule.meta.detection.filter((m): m is 'static' | 'runtime' => m !== 'intake');
    for (const mode of modes) {
      const mine = fixtures.filter((f) => f.ruleId === rule.meta.id && f.mode === mode && !f.fixed);

      it(`${rule.meta.id} ${mode}: at least two fixtures that fire`, () => {
        expect(mine.filter((f) => f.category === 'fires').length).toBeGreaterThanOrEqual(2);
      });

      it(`${rule.meta.id} ${mode}: at least two that stay quiet, one of them a near miss`, () => {
        const quiet = mine.filter((f) => f.category === 'pass' || f.category === 'near-miss');
        expect(quiet.length).toBeGreaterThanOrEqual(2);
        expect(quiet.some((f) => f.category === 'near-miss')).toBe(true);
      });
    }
  }
});

describe('fixture consistency', () => {
  for (const f of fixtures) {
    it(`${f.ruleId}/${f.name} is consistent with its category`, () => {
      if (f.category === 'fires' && !f.fixed) {
        expect(f.expect.length, 'a fires- fixture must expect a finding').toBeGreaterThan(0);
        expect(existsSync(`${f.dir}.fixed`), 'every fires- fixture needs a .fixed twin').toBe(true);
      }
      if (f.fixed) {
        expect(f.category).toBe('fires');
        expect(f.expect, 'a fixed twin must scan clean').toEqual([]);
        expect(f.mode).toBe(fixtures.find((o) => o.dir === f.dir.replace(/\.fixed$/, ''))?.mode);
      }
      if (f.category === 'pass' || f.category === 'near-miss') expect(f.expect).toEqual([]);
    });
  }
});
