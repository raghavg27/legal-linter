import { evaluateCapture, isLocalTarget, scanSite, type CaptureOptions, type Intake, type ScanReport, type StoredJudgments } from '@legal-lint/core';
import { rules } from '@legal-lint/rules';
import { apiUrl, remoteCapture } from './licence/api.ts';
import type { Licence } from './licence/gate.ts';
import type { RuntimeEnv } from './licence/store.ts';

export interface UrlScanOptions {
  rt: RuntimeEnv;
  licence: Licence;
  version: string;
  /** Use Chromium on this machine even for a public URL. */
  local?: boolean;
  only?: readonly string[];
  /** Page load timeout for local scans; the hosted scanner sets its own. */
  timeoutMs?: number;
  /** undefined: read legal-lint.config.json from the working directory, as before. */
  intake?: Intake | null;
  judgments?: StoredJudgments;
  capture?: Omit<CaptureOptions, 'toolVersion'>;
}

/** localhost and private addresses can only be reached from the user's machine. */
export function scansLocally(url: string, forceLocal?: boolean): boolean {
  return Boolean(forceLocal) || isLocalTarget(new URL(url).hostname);
}

/** Local scans use Chromium here; public URLs go to the hosted scanner. Rules always run here. */
export async function scanUrl(url: string, opts: UrlScanOptions): Promise<ScanReport> {
  const engine = { rules, toolVersion: opts.version, only: opts.only, intake: opts.intake, judgments: opts.judgments };
  if (scansLocally(url, opts.local)) {
    return scanSite(url, { ...engine, capture: { ...opts.capture, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) } });
  }
  const base = apiUrl(opts.rt.env);
  if (!base) throw new Error('No hosted scanner is configured (LEGAL_LINT_API_URL), so only local scans work. Add --local to scan with Chromium on this machine.');
  const capture = await remoteCapture(opts.rt, base, opts.licence.key, url, opts.version);
  const start = capture.pages[0];
  if (!start || start.error) throw new Error(`Could not load ${url}: ${start?.error ?? 'no response'}`);
  return evaluateCapture(capture, engine);
}
