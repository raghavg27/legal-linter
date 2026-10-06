import { Command, CommanderError, Option } from 'commander';
import {
  formatText,
  scanRepo,
  scanSite,
  type ScanReport,
} from '@legal-lint/core';
import { rules } from '@legal-lint/rules';
import pkg from '../package.json' with { type: 'json' };

export const VERSION: string = pkg.version;

export interface Io {
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

function output(report: ScanReport, json: boolean, io: Io): number {
  if (json) io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else io.stdout.write(`${formatText(report, { color: Boolean(io.stdout.isTTY) && !process.env.NO_COLOR })}\n`);
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

  program
    .command('scan')
    .description('Scan a repository on this machine. No source code leaves the machine.')
    .argument('[path]', 'repository root', '.')
    .option('--json', 'print the report as JSON')
    .addOption(ruleOption())
    .action(async (root: string, opts: { json?: boolean; rule?: string[] }) => {
      const report = await scanRepo(root, { rules, toolVersion: VERSION, only: knownRuleIds(opts.rule) });
      setExit(output(report, Boolean(opts.json), io));
    });

  program
    .command('scan-url')
    .description('Load a live or preview URL in headless Chromium and check what happens before any interaction.')
    .argument('<url>', 'http(s) URL to scan')
    .option('--json', 'print the report as JSON')
    .option('--timeout <ms>', 'page load timeout in milliseconds', (v) => Number.parseInt(v, 10), 30_000)
    .addOption(ruleOption())
    .action(async (url: string, opts: { json?: boolean; rule?: string[]; timeout: number }) => {
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
      setExit(output(report, Boolean(opts.json), io));
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
