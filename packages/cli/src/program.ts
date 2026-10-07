import { Command, CommanderError, Option } from 'commander';
import type { Readable } from 'node:stream';
import { defaultReportPath, formatText, intakeSchema, scanRepo, scanSite, writeHtmlReport, type ScanReport } from '@legal-lint/core';
import { rules } from '@legal-lint/rules';
import { askIntake, writeIntake } from './init.ts';
import pkg from '../package.json' with { type: 'json' };

export const VERSION: string = pkg.version;

export interface Io {
  stdin?: Readable;
  stdout: { write(s: string): unknown; isTTY?: boolean };
  stderr: { write(s: string): unknown };
}

/** 0: no open findings. 1: at least one open finding. 2: the scan could not run. */
export const EXIT = { clean: 0, findings: 1, error: 2 } as const;

class UsageError extends Error {}

function knownRuleIds(ids: string[] | undefined): string[] | undefined {
  if (!ids) return undefined;
  const known = new Set(rules.map((r) => r.meta.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) throw new UsageError(`Unknown rule id: ${unknown.join(', ')}. Known: ${[...known].join(', ')}`);
  return ids;
}

interface OutputOptions {
  json?: boolean;
  /** true: write to the default report path. A string: write there. */
  html?: boolean | string;
}

async function output(report: ScanReport, opts: OutputOptions, reportDir: string, io: Io): Promise<number> {
  if (opts.json) io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else io.stdout.write(`${formatText(report, { color: Boolean(io.stdout.isTTY) && !process.env.NO_COLOR })}\n`);
  if (opts.html) {
    const file = await writeHtmlReport(report, opts.html === true ? defaultReportPath(reportDir) : opts.html);
    // stderr, so --json output stays parseable.
    io.stderr.write(`HTML report: ${file}\n`);
  }
  return report.summary.open > 0 ? EXIT.findings : EXIT.clean;
}

function buildProgram(io: Io, setExit: (code: number) => void): Command {
  const program = new Command('legal-lint')
    .description('Finds legal traps in startup codebases and live sites. Reports and guides; never edits code.')
    .version(VERSION)
    .exitOverride()
    .configureOutput({ writeOut: (s) => io.stdout.write(s), writeErr: (s) => io.stderr.write(s) })
    .addHelpText('after', '\nExit codes: 0 no open findings, 1 open findings, 2 the scan could not run.');

  const ruleOption = () => new Option('--rule <ids...>', 'only run these rules, e.g. --rule LL-01');
  const htmlOption = () =>
    new Option('--html [file]', 'also write an HTML report for the product owner (default: .legal-lint/report.html)');

  program
    .command('scan')
    .description('Scan a repository on this machine. No source code leaves the machine.')
    .argument('[path]', 'repository root', '.')
    .option('--json', 'print the report as JSON')
    .addOption(ruleOption())
    .addOption(htmlOption())
    .action(async (root: string, opts: OutputOptions & { rule?: string[] }) => {
      const report = await scanRepo(root, { rules, toolVersion: VERSION, only: knownRuleIds(opts.rule) });
      setExit(await output(report, opts, root, io));
    });

  program
    .command('scan-url')
    .description('Load a live or preview URL in headless Chromium and check what happens before any interaction.')
    .argument('<url>', 'http(s) URL to scan')
    .option('--json', 'print the report as JSON')
    .option('--timeout <ms>', 'page load timeout in milliseconds', (v) => Number.parseInt(v, 10), 30_000)
    .addOption(ruleOption())
    .addOption(htmlOption())
    .action(async (url: string, opts: OutputOptions & { rule?: string[]; timeout: number }) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new UsageError(`Not a valid URL: ${url}`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new UsageError('Only http and https URLs can be scanned.');
      const report = await scanSite(parsed.href, {
        rules,
        toolVersion: VERSION,
        only: knownRuleIds(opts.rule),
        capture: { timeoutMs: opts.timeout },
      });
      setExit(await output(report, opts, process.cwd(), io));
    });

  program
    .command('init')
    .description('Answer the project questions that decide which rules apply. Writes legal-lint.config.json.')
    .argument('[path]', 'repository root', '.')
    .option('--answers <json>', 'answers as JSON instead of prompts, e.g. \'{"euUkVisitors":true}\'')
    .option('--force', 'replace existing intake answers')
    .action(async (dir: string, opts: { answers?: string; force?: boolean }) => {
      let intake;
      if (opts.answers !== undefined) {
        let json: unknown;
        try {
          json = JSON.parse(opts.answers);
        } catch {
          throw new UsageError('--answers is not valid JSON.');
        }
        const parsed = intakeSchema.safeParse(json);
        if (!parsed.success) {
          throw new UsageError(`--answers has invalid values: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        }
        intake = parsed.data;
      } else {
        io.stdout.write('A few questions decide which rules apply. Press Enter to skip any you are unsure of.\n\n');
        intake = await askIntake(io.stdin ?? process.stdin, io.stdout);
      }
      const file = await writeIntake(dir, intake, Boolean(opts.force));
      io.stdout.write(`\nWrote ${file}. Skipped questions stay unknown, and rules that need them will ask.\n`);
    });

  return program;
}

export async function run(argv: string[], io: Io = process): Promise<number> {
  let code: number = EXIT.clean;
  const program = buildProgram(io, (c) => {
    code = c;
  });
  try {
    await program.parseAsync(argv, { from: 'user' });
    return code;
  } catch (e) {
    // Commander has already printed its own usage message.
    if (e instanceof CommanderError) return e.exitCode === 0 ? EXIT.clean : EXIT.error;
    io.stderr.write(`legal-lint: ${(e as Error).message}\n`);
    return EXIT.error;
  }
}
