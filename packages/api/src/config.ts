import type { ScanLimits } from './store.ts';

export interface ApiConfig {
  limits: ScanLimits;
  licenceChecksPerIpHour: number;
  failedAuthPerIpHour: number;
  maxRunning: number;
  maxWaiting: number;
  /** X-Forwarded-For entries that trusted proxies add (examine this after the first deploy, DEPLOY.md). */
  trustedHops: number;
  pageTimeoutMs: number;
  budgetMs: number;
  /** Hard limit for one scan. */
  deadlineMs: number;
  /** For each page. Thus one very large page cannot make a large response that costs money. */
  maxPageHtmlChars: number;
  maxPageTextChars: number;
  /** Temporary. Use it to find the layout of the client IP header after the first deploy. */
  logForwardedFor: boolean;
}

function int(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** With the defaults, a month of worst-case scans uses half of the free quota of Cloud Run (see the spec). */
export function readConfig(env: NodeJS.ProcessEnv): ApiConfig {
  return {
    limits: {
      perKeyHour: int(env.SCANS_PER_KEY_HOUR, 10),
      perKeyDay: int(env.SCANS_PER_KEY_DAY, 50),
      perMonth: int(env.SCANS_PER_MONTH, 1500),
    },
    licenceChecksPerIpHour: int(env.LICENCE_CHECKS_PER_IP_HOUR, 30),
    failedAuthPerIpHour: int(env.FAILED_AUTH_PER_IP_HOUR, 10),
    maxRunning: int(env.MAX_RUNNING_SCANS, 2),
    maxWaiting: int(env.MAX_WAITING_SCANS, 4),
    trustedHops: Math.max(1, int(env.TRUSTED_PROXY_HOPS, 1)),
    pageTimeoutMs: int(env.PAGE_TIMEOUT_MS, 15_000),
    budgetMs: int(env.SCAN_BUDGET_MS, 40_000),
    deadlineMs: int(env.SCAN_DEADLINE_MS, 60_000),
    maxPageHtmlChars: int(env.MAX_PAGE_HTML_CHARS, 1_000_000),
    maxPageTextChars: int(env.MAX_PAGE_TEXT_CHARS, 300_000),
    logForwardedFor: env.LOG_FORWARDED_FOR === '1',
  };
}
