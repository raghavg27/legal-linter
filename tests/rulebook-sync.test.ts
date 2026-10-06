import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { rules } from '@legal-lint/rules';
import { bannedWording } from './helpers/wording.ts';

// legal.yaml and rule metadata must match RULEBOOK.md word for word, so the
// lawyer reviews one document and the shipped text cannot drift from it.

interface RulebookEntry {
  name: string;
  fields: Map<string, { paren?: string; value: string }>;
}

function parseRulebook(md: string): Map<string, RulebookEntry> {
  const entries = new Map<string, RulebookEntry>();
  for (const section of md.split(/^## /m)) {
    const header = /^(LL-\d{2}) · (.+)$/m.exec(section);
    if (!header) continue;
    const fields = new Map<string, { paren?: string; value: string }>();
    for (const m of section.matchAll(/^- \*\*(.+?)\*\*(?: \(([^)]*)\))?: (.*)$/gm)) {
      fields.set(m[1]!, { paren: m[2], value: m[3]!.trim() });
    }
    entries.set(header[1]!, { name: header[2]!.trim(), fields });
  }
  return entries;
}

const rulebook = parseRulebook(readFileSync(path.resolve(import.meta.dirname, '../RULEBOOK.md'), 'utf8'));

describe('rulebook sync', () => {
  it('parses all 15 rulebook rules', () => {
    expect(rulebook.size).toBe(15);
  });

  for (const rule of rules) {
    describe(rule.meta.id, () => {
      const entry = rulebook.get(rule.meta.id)!;
      const field = (label: string) => {
        const f = entry.fields.get(label);
        if (!f) throw new Error(`${rule.meta.id}: rulebook has no "${label}" field`);
        return f;
      };

      it('metadata matches the rulebook', () => {
        expect(rule.meta.name).toBe(entry.name);
        expect(rule.meta.law).toBe(field('Law').value);
        expect(rule.meta.regions).toEqual(field('Region').value.split(', '));
        expect(String(rule.meta.phase)).toBe(field('Phase').value.split(' ')[0]);
        expect(rule.meta.fixType).toBe(field('Fix').paren);
        expect([...rule.meta.detection].sort()).toEqual(field('Detection').paren!.split(', ').sort());
      });

      it('legal.yaml copies the rulebook word for word', () => {
        expect(rule.legal.name).toBe(entry.name);
        expect(rule.legal.law).toBe(field('Law').value);
        expect(rule.legal.trap).toBe(field('Trap').value);
        expect(rule.legal.appliesWhen).toBe(field('Applies when').value);
        expect(rule.legal.exposure).toBe(field('Exposure').value);
        expect(rule.legal.detectionConfidence).toBe(field('Detection confidence').value);
      });

      it('text we wrote ourselves avoids conclusions and promises', () => {
        const ours = [
          rule.legal.doesNotApplyIf,
          rule.fix.goal,
          ...rule.fix.doneWhen,
          ...rule.fix.steps.flatMap((s) => [s.title, s.why, s.instructions, ...Object.values(s.variants ?? {})]),
          ...rule.fix.ownerSteps.flatMap((s) => [s.title, s.why]),
        ];
        for (const text of ours) expect(bannedWording(text), text).toBeNull();
      });

      it('fix guidance ends with a re-scan', () => {
        expect(rule.fix.doneWhen.some((d) => /re-?scan/i.test(d))).toBe(true);
      });
    });
  }
});
