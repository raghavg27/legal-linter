import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { configSchema, type Intake, type LegalLintConfig } from './schemas.ts';
import type { ApplicabilityResult, IntakeQuestion } from './types.ts';

export const CONFIG_FILE = 'legal-lint.config.json';

/** Wording of each intake question, from the rulebook's intake list. */
export const INTAKE_QUESTIONS: Record<keyof Intake, string> = {
  countries: 'Which countries does the product serve? (ISO codes, e.g. US, DE, IN)',
  euUkVisitors: 'Are visitors from the EU, EEA or UK expected?',
  audience: 'Who is the audience: general, teens, under-13, or mixed?',
  revenueBand: 'What is the annual revenue band?',
  userCount: 'Roughly how many users or consumers does the product have?',
  sellsSubscriptions: 'Does the product sell subscriptions?',
  sendsMarketingEmail: 'Does the product send marketing email?',
  sendsMarketingSms: 'Does the product send marketing SMS?',
  hostsPublicUploads: 'Does the product host user uploads publicly?',
  dmcaAgentRegistered: 'Is a DMCA designated agent registered with the US Copyright Office?',
  handlesHealthData: 'Does the product handle health or wellness data?',
  servesVideo: 'Does the product serve video content?',
  shipsMobileApps: 'Does the product ship iOS or Android apps?',
};

export function intakeQuestions(keys: (keyof Intake)[]): IntakeQuestion[] {
  return keys.map((key) => ({ key, question: INTAKE_QUESTIONS[key] }));
}

/** EU member states plus the EEA (Iceland, Liechtenstein, Norway). */
export const EU_EEA_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO',
]);

/**
 * Shared applicability for EU-scoped rules. The intake asks one combined
 * EU/UK question, so a "yes" there counts as yes (see DECISIONS.md).
 */
export function appliesToEuVisitors(intake: Intake | null): ApplicabilityResult {
  if (intake?.euUkVisitors === true) return { value: 'yes', reason: 'Intake: EU/EEA/UK visitors are expected.' };
  if (intake?.euUkVisitors === false) return { value: 'no', reason: 'Intake: no EU/EEA/UK visitors are expected.' };
  const eu = intake?.countries?.filter((c) => EU_EEA_COUNTRIES.has(c)) ?? [];
  if (eu.length > 0) return { value: 'yes', reason: `Intake: serves ${eu.join(', ')}.` };
  return {
    value: 'unknown',
    reason: 'The intake does not say whether EU/EEA visitors are expected.',
    missing: ['euUkVisitors'],
  };
}

export class ConfigError extends Error {}

/** Reads legal-lint.config.json from a directory. Returns null when there is none. */
export async function loadConfig(dir: string): Promise<LegalLintConfig | null> {
  const file = path.join(dir, CONFIG_FILE);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new ConfigError(`${CONFIG_FILE} is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = configSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ConfigError(`${CONFIG_FILE} has invalid values:\n  ${issues.join('\n  ')}`);
  }
  return parsed.data;
}
