import type { FixGuidance, Framework, Rule } from './types.ts';

export interface SelectedStep {
  title: string;
  why: string;
  instructions: string;
  /** Framework-specific instructions for the frameworks found in the repo, or every variant when none was found. */
  forFramework: Partial<Record<Framework, string>>;
}

export interface SelectedGuidance extends Omit<FixGuidance, 'steps'> {
  frameworks: Framework[];
  steps: SelectedStep[];
}

/** The rule's fix guidance with only the variants that match the repo's frameworks. */
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
