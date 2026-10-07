import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { Readable } from 'node:stream';
import { CONFIG_FILE, INTAKE_QUESTIONS, intakeSchema, loadConfig, type Intake } from '@legal-lint/core';

type Spec =
  | { key: keyof Intake; kind: 'boolean' }
  | { key: keyof Intake; kind: 'countries' }
  | { key: keyof Intake; kind: 'choice'; choices: string[] };

/** The intake list of the rulebook, in its sequence. You can skip each question. Skipped means "unknown", never "no". */
export const INTAKE_SPECS: Spec[] = [
  { key: 'countries', kind: 'countries' },
  { key: 'euUkVisitors', kind: 'boolean' },
  { key: 'audience', kind: 'choice', choices: ['general', 'teens', 'under13', 'mixed'] },
  { key: 'revenueBand', kind: 'choice', choices: ['under-1m', '1m-26.6m', 'over-26.6m'] },
  { key: 'userCount', kind: 'choice', choices: ['under-10k', '10k-100k', 'over-100k'] },
  { key: 'sellsSubscriptions', kind: 'boolean' },
  { key: 'sendsMarketingEmail', kind: 'boolean' },
  { key: 'sendsMarketingSms', kind: 'boolean' },
  { key: 'hostsPublicUploads', kind: 'boolean' },
  { key: 'dmcaAgentRegistered', kind: 'boolean' },
  { key: 'handlesHealthData', kind: 'boolean' },
  { key: 'servesVideo', kind: 'boolean' },
  { key: 'shipsMobileApps', kind: 'boolean' },
];

function hint(spec: Spec): string {
  if (spec.kind === 'boolean') return 'y/n';
  if (spec.kind === 'countries') return 'comma-separated ISO codes';
  return spec.choices.join('/');
}

/** Parses one typed answer. undefined: skipped. Throws an error on an answer that it cannot understand. */
export function parseAnswer(spec: Spec, input: string): Intake[keyof Intake] | undefined {
  const v = input.trim();
  if (v === '') return undefined;
  switch (spec.kind) {
    case 'boolean':
      if (/^(y|yes)$/i.test(v)) return true;
      if (/^(n|no)$/i.test(v)) return false;
      throw new Error('please answer y or n, or press Enter to skip');
    case 'countries': {
      const codes = v.split(/[\s,]+/).filter(Boolean).map((c) => c.toUpperCase());
      if (codes.some((c) => !/^[A-Z]{2}$/.test(c))) throw new Error('use two-letter country codes, e.g. US, DE, IN');
      return codes;
    }
    case 'choice': {
      const choice = spec.choices.find((c) => c.toLowerCase() === v.toLowerCase().replace(/^under-13$/, 'under13'));
      if (!choice) throw new Error(`choose one of: ${spec.choices.join(', ')}`);
      return choice;
    }
  }
}

export async function askIntake(input: Readable, output: { write(s: string): unknown }): Promise<Intake> {
  const rl = createInterface({ input, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const intake: Record<string, unknown> = {};
  try {
    for (const spec of INTAKE_SPECS) {
      for (;;) {
        output.write(`${INTAKE_QUESTIONS[spec.key]} [${hint(spec)}, Enter to skip] `);
        const next = await lines.next();
        if (next.done) return intakeSchema.parse(intake);
        try {
          const answer = parseAnswer(spec, String(next.value));
          if (answer !== undefined) intake[spec.key] = answer;
          break;
        } catch (e) {
          output.write(`  ${(e as Error).message}\n`);
        }
      }
    }
  } finally {
    rl.close();
  }
  return intakeSchema.parse(intake);
}

export class InitError extends Error {}

/**
 * Writes the intake into legal-lint.config.json, and keeps all other keys
 * (stored judgments, licence key). Without force, it does not replace intake
 * that has answers.
 */
export async function writeIntake(dir: string, intake: Intake, force: boolean): Promise<string> {
  const file = path.join(dir, CONFIG_FILE);
  const existing = await loadConfig(dir);
  if (existing?.intake && !force) {
    throw new InitError(`${CONFIG_FILE} already has intake answers. Run with --force to answer again.`);
  }
  const raw = existing ? (JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>) : {};
  await writeFile(file, `${JSON.stringify({ ...raw, intake }, null, 2)}\n`);
  return file;
}
