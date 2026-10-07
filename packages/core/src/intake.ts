import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configSchema, type Intake, type LegalLintConfig } from './schemas.ts';
import type { ApplicabilityResult, IntakeQuestion } from './types.ts';

export const CONFIG_FILE = 'legal-lint.config.json';

/** The text of each intake question, from the intake list of the rulebook. */
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

/** EU member states and the EEA (Iceland, Liechtenstein, Norway). */
export const EU_EEA_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO',
]);

/**
 * Shared applicability for rules about the EU. The intake asks one question for
 * the EU and the UK together. Thus a "yes" to that question counts as yes (see DECISIONS.md).
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

/** Reads legal-lint.config.json from a directory. Returns null when there is no file. */
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

/**
 * Applies a change to legal-lint.config.json. Keeps each key that the change
 * does not touch, and validates the result before it writes. Returns the file path.
 */
export async function updateConfigFile(
  dir: string,
  update: (raw: Record<string, unknown>) => Record<string, unknown>,
): Promise<string> {
  const file = path.join(dir, CONFIG_FILE);
  const existing = await loadConfig(dir);
  const raw = existing ? (JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>) : {};
  const next = update(raw);
  const parsed = configSchema.safeParse(next);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ConfigError(`Refusing to write ${CONFIG_FILE}:\n  ${issues.join('\n  ')}`);
  }
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
  return file;
}

/** Adds intake answers. Replaces the old answers to the same questions. */
export function mergeIntake(dir: string, answers: Intake): Promise<string> {
  return updateConfigFile(dir, (raw) => ({ ...raw, intake: { ...(raw.intake as Intake | undefined), ...answers } }));
}
