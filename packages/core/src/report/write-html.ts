import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ScanReport } from '../types.ts';
import { formatHtml } from './html.ts';

/** Folder for generated reports. It ignores itself in git, so a report is never committed by accident. */
export const REPORT_DIR = '.legal-lint';

export function defaultReportPath(dir: string): string {
  return path.join(path.resolve(dir), REPORT_DIR, 'report.html');
}

/** Writes the HTML report and returns its absolute path. */
export async function writeHtmlReport(report: ScanReport, file: string): Promise<string> {
  const abs = path.resolve(file);
  const dir = path.dirname(abs);
  await mkdir(dir, { recursive: true });
  if (path.basename(dir) === REPORT_DIR) await writeFile(path.join(dir, '.gitignore'), '*\n');
  await writeFile(abs, formatHtml(report));
  return abs;
}
