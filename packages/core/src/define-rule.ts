import { parse } from 'yaml';
import { fixGuidanceSchema, legalTextSchema } from './schemas.ts';
import type { Rule } from './types.ts';

export interface RuleDefinition extends Omit<Rule, 'legal' | 'fix'> {
  /** Raw contents of the rule's legal.yaml. */
  legalYaml: string;
  /** Raw contents of the rule's fix.yaml. */
  fixYaml: string;
}

function parseData<T>(label: string, yaml: string, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }): T {
  const result = schema.safeParse(parse(yaml));
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`);
    throw new Error(`${label} is invalid:\n  ${issues.join('\n  ')}`);
  }
  return result.data;
}

/** Validates a rule's data files at load time, so a broken YAML file fails loudly instead of producing odd findings. */
export function defineRule(def: RuleDefinition): Rule {
  const { legalYaml, fixYaml, ...rest } = def;
  const legal = parseData(`${def.meta.id} legal.yaml`, legalYaml, legalTextSchema);
  const fix = parseData(`${def.meta.id} fix.yaml`, fixYaml, fixGuidanceSchema);
  for (const [label, id] of [['legal.yaml', legal.ruleId], ['fix.yaml', fix.ruleId]] as const) {
    if (id !== def.meta.id) throw new Error(`${def.meta.id}: ${label} has ruleId ${id}`);
  }
  if (legal.name !== def.meta.name || legal.law !== def.meta.law) {
    throw new Error(`${def.meta.id}: name or law in legal.yaml differs from the rule metadata`);
  }
  if (fix.fixType !== def.meta.fixType) throw new Error(`${def.meta.id}: fixType differs between fix.yaml and metadata`);
  return { ...rest, legal, fix };
}
