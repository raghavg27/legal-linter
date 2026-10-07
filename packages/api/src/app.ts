import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { licenceRequestSchema, scanRequestSchema, type ApiErrorReason } from '@legal-lint/core/remote';
import type { SiteCapture } from '@legal-lint/core';
import type { ApiConfig } from './config.ts';
import { checkTarget, type Resolver, type TargetPolicy } from './egress/target.ts';
import { checkKey, hashKey, keyPrefix as prefixOf, type KeyCheck } from './keys.ts';
import { BusyError, clientIp, FixedWindowLimiter, ScanQueue } from './limits.ts';
import type { KeyStore, UsageStore } from './store.ts';

export interface LogEntry {
  route: string;
  outcome: string;
  keyPrefix?: string;
  host?: string;
  ms?: number;
  forwardedFor?: string;
}

export interface AppDeps {
  keys: KeyStore;
  usage: UsageStore;
  scanner: { scan(url: string): Promise<SiteCapture> };
  policy: TargetPolicy;
  resolve: Resolver;
  config: ApiConfig;
  now?: () => Date;
  log?: (entry: LogEntry) => void;
}

const HOUR = 3_600_000;

export function createApp(deps: AppDeps): Hono {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((entry: LogEntry) => console.log(JSON.stringify(entry)));
  const cfg = deps.config;
  const licenceChecks = new FixedWindowLimiter(cfg.licenceChecksPerIpHour, HOUR);
  const failures = new FixedWindowLimiter(cfg.failedAuthPerIpHour, HOUR);
  const queue = new ScanQueue(cfg.maxRunning, cfg.maxWaiting);

  const fail = (c: Context, status: ContentfulStatusCode, reason: ApiErrorReason, message: string, retryAfterSec?: number) =>
    c.json({ error: { reason, message } }, status, retryAfterSec ? { 'Retry-After': String(retryAfterSec) } : {});
  const ipOf = (c: Context) => clientIp(c.req.header('x-forwarded-for'), cfg.trustedHops);
  const tooMany = (c: Context) => fail(c, 429, 'too_many_requests', 'Too many requests from this address. Try again later.', 3600);
  const bodyOf = async (c: Context) => c.req.json().catch(() => null);

  // A key that hit its hourly or daily limit, and the monthly cap, are remembered
  // until the window ends, so repeats are refused without store reads or a queue place.
  type LimitReason = 'key_hour' | 'key_day' | 'monthly_budget';
  const blockedKeys = new Map<string, { until: number; reason: 'key_hour' | 'key_day' }>();
  let monthBlockedUntil = 0;
  const limitReached = (c: Context, reason: LimitReason, retryAfterSec: number) => {
    if (reason === 'monthly_budget') {
      return fail(c, 503, 'monthly_budget', 'The hosted scanner has used its scans for this month. Scan on your own machine with --local.', retryAfterSec);
    }
    const window = reason === 'key_hour' ? 'hourly' : 'daily';
    return fail(c, 429, reason, `This key has used its ${window} hosted scans. Try later, or scan on your own machine with --local.`, retryAfterSec);
  };
  const secondsUntil = (until: number, t: Date) => Math.max(1, Math.ceil((until - t.getTime()) / 1000));

  const app = new Hono();
  app.use('/v1/*', bodyLimit({ maxSize: 4 * 1024, onError: (c) => fail(c, 413, 'bad_request', 'Request body too large.') }));
  app.onError((_e, c) => fail(c, 500, 'internal', 'Something went wrong on the Legal Lint server.'));
  app.get('/healthz', (c) => c.json({ ok: true }));

  app.post('/v1/licence', async (c) => {
    const ip = ipOf(c);
    const t = now();
    if (cfg.logForwardedFor) log({ route: 'licence', outcome: 'debug', forwardedFor: c.req.header('x-forwarded-for') ?? '' });
    if (failures.blocked(ip, t)) return tooMany(c);
    const limited = licenceChecks.hit(ip, t);
    if (!limited.ok) return fail(c, 429, 'too_many_requests', 'Too many licence checks from this address. Try again later.', limited.retryAfterSec);
    const body = licenceRequestSchema.safeParse(await bodyOf(c));
    if (!body.success) return fail(c, 400, 'bad_request', 'Expected {"key","version"} and nothing else.');
    const check = await checkKey(deps.keys, body.data.key, t);
    if (!check.valid) {
      failures.hit(ip, t);
      log({ route: 'licence', outcome: check.reason });
      return c.json({ valid: false, reason: check.reason });
    }
    log({ route: 'licence', outcome: 'valid', keyPrefix: check.record.prefix });
    return c.json({ valid: true, expiresAt: check.record.expiresAt });
  });

  app.post('/v1/scan', async (c) => {
    const started = Date.now();
    const ip = ipOf(c);
    const t = now();
    if (failures.blocked(ip, t)) return tooMany(c);
    const bearer = /^Bearer (\S+)$/.exec(c.req.header('authorization') ?? '');
    if (bearer) {
      const blocked = blockedKeys.get(hashKey(bearer[1]!));
      if (blocked && blocked.until > t.getTime()) {
        log({ route: 'scan', outcome: blocked.reason, keyPrefix: prefixOf(bearer[1]!) });
        return limitReached(c, blocked.reason, secondsUntil(blocked.until, t));
      }
      if (blocked) blockedKeys.delete(hashKey(bearer[1]!));
    }
    const check: KeyCheck = bearer ? await checkKey(deps.keys, bearer[1]!, t) : { valid: false, reason: 'unknown' };
    if (!check.valid) {
      failures.hit(ip, t);
      log({ route: 'scan', outcome: `key_${check.reason}` });
      const why = check.reason === 'unknown' ? 'missing or not recognised' : check.reason;
      return fail(c, 401, 'unauthorized', `The licence key is ${why}.`);
    }
    const keyPrefix = check.record.prefix;
    if (monthBlockedUntil > t.getTime()) {
      log({ route: 'scan', outcome: 'monthly_budget', keyPrefix });
      return limitReached(c, 'monthly_budget', secondsUntil(monthBlockedUntil, t));
    }
    const body = scanRequestSchema.safeParse(await bodyOf(c));
    if (!body.success) return fail(c, 400, 'bad_request', 'Expected {"url","version"} and nothing else.');
    const target = await checkTarget(body.data.url, deps.policy, deps.resolve);
    if (!target.ok) {
      log({ route: 'scan', outcome: target.reason, keyPrefix });
      return fail(c, 400, target.reason, target.message);
    }
    const host = new URL(target.url).host;
    const done = (outcome: string) => log({ route: 'scan', outcome, keyPrefix, host, ms: Date.now() - started });

    try {
      return await queue.run(async () => {
        // Counted when Chromium is about to start, since that is when compute is spent.
        const reservedAt = now();
        const reservation = await deps.usage.reserveScan(check.hash, reservedAt, cfg.limits);
        if (!reservation.ok) {
          done(reservation.reason);
          const until = reservedAt.getTime() + reservation.retryAfterSec * 1000;
          if (reservation.reason === 'monthly_budget') monthBlockedUntil = until;
          else blockedKeys.set(check.hash, { until, reason: reservation.reason });
          return limitReached(c, reservation.reason, reservation.retryAfterSec);
        }
        try {
          const capture = await deps.scanner.scan(target.url);
          done('ok');
          return c.json({ capture });
        } catch (e) {
          done('scan_failed');
          return fail(c, 502, 'scan_failed', `Could not scan ${host}: ${(e as Error).message.split('\n')[0]}`);
        }
      });
    } catch (e) {
      if (!(e instanceof BusyError)) throw e;
      done('busy');
      return fail(c, 503, 'busy', 'The hosted scanner is busy. Try again in a minute, or scan with --local.', 30);
    }
  });

  return app;
}
