import type { FixGuidance, Framework, Rule } from './types.ts';

export interface SelectedStep {
  title: string;
  why: string;
  instructions: string;
  /** The instructions for each framework that the repo uses. If the repo uses no known framework, all variants. */
  forFramework: Partial<Record<Framework, string>>;
}

export interface SelectedGuidance extends Omit<FixGuidance, 'steps'> {
  frameworks: Framework[];
  steps: SelectedStep[];
}

/** The fix guidance of the rule, with only the variants that match the frameworks of the repo. */
export function guidanceFor(rule: Rule, frameworks: readonly Framework[]): SelectedGuidance {
  const { steps, ...rest } = rule.fix;
  return {
    ...rest,
    frameworks: [...frameworks],
    steps: steps.map(({ variants, ...step }) => {
      const all = variants ?? {};
      const picked = frameworks.length
        ? Object.fromEntries(frameworks.filter((f) => all[f]).map((f) => [f, all[f]!]))
        : { ...all };
      return { ...step, forFramework: picked };
    }),
  };
}
