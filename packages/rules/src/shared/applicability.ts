import type { ApplicabilityResult, Intake } from '@legal-lint/core';

/**
 * US-scoped rules (California visitors, US recipients). The intake asks for
 * countries, not states, so serving the US counts as having California visitors.
 * Unlike the EU check there is no dedicated question, so a country list without
 * the US is taken as the owner's answer.
 */
export function appliesToUsVisitors(intake: Intake | null, who: string): ApplicabilityResult {
  const countries = intake?.countries;
  if (!countries) {
    return { value: 'unknown', reason: `The intake does not list the countries served, so ${who} are unknown.`, missing: ['countries'] };
  }
  if (countries.includes('US')) return { value: 'yes', reason: `Intake: serves the US, so ${who} are expected.` };
  return { value: 'no', reason: `Intake: does not serve the US (${countries.join(', ') || 'none listed'}).` };
}

/** Combines a yes/no intake flag with US applicability. */
export function appliesWithFlag(
  intake: Intake | null,
  flag: keyof Intake,
  yes: string,
  no: string,
  who: string,
): ApplicabilityResult {
  const value = intake?.[flag];
  if (value === false) return { value: 'no', reason: `Intake: ${no}.` };
  const us = appliesToUsVisitors(intake, who);
  if (us.value === 'no') return us;
  const missing = [...(value === undefined ? [flag] : []), ...(us.missing ?? [])];
  if (missing.length > 0) return { value: 'unknown', reason: `The intake does not yet say: ${missing.join(', ')}.`, missing };
  return { value: 'yes', reason: `Intake: ${yes}, and serves the US.` };
}
