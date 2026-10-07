import type { ApplicabilityResult, Intake } from '@legal-lint/core';

/**
 * Rules for the US (visitors from California, recipients in the US). The intake
 * asks for countries, not states. Thus a site that serves the US counts as a site
 * with visitors from California. The EU check has a separate question, but this
 * check does not. Thus a country list without the US is the answer of the owner.
 */
export function appliesToUsVisitors(intake: Intake | null, who: string): ApplicabilityResult {
  const countries = intake?.countries;
  if (!countries) {
    return { value: 'unknown', reason: `The intake does not list the countries served, so ${who} are unknown.`, missing: ['countries'] };
  }
  if (countries.includes('US')) return { value: 'yes', reason: `Intake: serves the US, so ${who} are expected.` };
  return { value: 'no', reason: `Intake: does not serve the US (${countries.join(', ') || 'none listed'}).` };
}

/** Combines a yes/no intake flag with the US applicability. */
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
