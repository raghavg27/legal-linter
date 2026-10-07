import type { Browser, BrowserContext } from 'playwright';
import type { CapturedRequest, PageCapture, SiteCapture } from '../types.ts';

export interface CaptureOptions {
  toolVersion: string;
  /** Navigation timeout for each page. */
  timeoutMs?: number;
  /** Use this browser again (tests share one). If not set, the crawler starts a browser and closes it. */
  browser?: Browser;
  /**
   * Record requests to hosts that are not local, but answer them locally with an
   * empty response. Thus no data goes out of the machine. The test suite uses this.
   */
  offline?: boolean;
  /** Pages to visit, with the start page. The other pages are links on the same origin that the rules need. Default 5. */
  maxPages?: number;
  /** Do not start new pages after this number of milliseconds from the start of the crawl. The hosted API uses it to limit the cost of a scan. */
  budgetMs?: number;
  /**
   * Hard limit for the full crawl. At this limit, the browser context closes.
   * This stops each call that waits on a frozen page, and the crawl throws an error.
   */
  deadlineMs?: number;
}

/** Links from the start page that the crawler follows: pricing for LL-04, copyright/DMCA for LL-05, and legal pages. */
const RELEVANT_LINK = /\b(pricing|plans?|upgrade|subscribe|subscriptions?|billing|dmca|copyright|terms|legal)\b/i;

/** Links on the same origin from the start page, with a path or text that matches RELEVANT_LINK. Pricing first. */
export function pickFollowLinks(start: PageCapture, max: number): string[] {
  if (max <= 0) return [];
  const origin = new URL(start.finalUrl).origin;
  const seen = new Set([stripHash(start.finalUrl)]);
  const picked: { url: string; rank: number }[] = [];
  for (const link of start.links) {
    let url: URL;
    try {
      url = new URL(link.href);
    } catch {
      continue;
    }
    const key = stripHash(url.href);
    if (url.origin !== origin || seen.has(key)) continue;
    const haystack = `${url.pathname} ${link.text}`;
    if (!RELEVANT_LINK.test(haystack)) continue;
    seen.add(key);
    picked.push({ url: key, rank: /pricing|plans?/i.test(haystack) ? 0 : 1 });
  }
  return picked.sort((a, b) => a.rank - b.rank).slice(0, max).map((p) => p.url);
}

function stripHash(url: string): string {
  const u = new URL(url);
  u.hash = '';
  return u.href;
}

export function userAgent(version: string): string {
  return `Mozilla/5.0 (compatible; LegalLint/${version}; +https://www.npmjs.com/package/legal-lint)`;
}

export class PlaywrightMissingError extends Error {
  constructor() {
    super(
      'URL scans need Playwright and Chromium. Install them with:\n' +
        '  npm install playwright && npx playwright install chromium',
    );
  }
}

async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    throw new PlaywrightMissingError();
  }
}

function isLocalUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol === 'data:' || protocol === 'blob:') return true;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

async function capturePage(context: BrowserContext, url: string, timeoutMs: number, offline: boolean): Promise<PageCapture> {
  const page = await context.newPage();
  const requests: CapturedRequest[] = [];
  let navigationStart = Date.now();
  page.on('request', (req) => {
    requests.push({
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
      msSinceNavigation: Date.now() - navigationStart,
    });
  });
  // Some replay tools (Hotjar) send recordings through a websocket. A websocket is not a "request" event.
  const recordSocket = (wsUrl: string) =>
    requests.push({ url: wsUrl, method: 'GET', resourceType: 'websocket', msSinceNavigation: Date.now() - navigationStart });
  if (offline) {
    // A mock socket does not send a "websocket" event. Thus record it in the handler. The code never calls connectToServer(), thus the socket stays local.
    await page.routeWebSocket(/.*/, (ws) => recordSocket(ws.url()));
  } else {
    page.on('websocket', (ws) => recordSocket(ws.url()));
  }

  const capture: PageCapture = {
    url,
    finalUrl: url,
    status: null,
    requests,
    cookies: [],
    text: '',
    html: '',
    links: [],
  };
  try {
    navigationStart = Date.now();
    const response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    // Give late scripts (replay SDKs, tag managers) a short time. Do not wait for all time on pages with much network traffic.
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    capture.status = response?.status() ?? null;
    capture.finalUrl = page.url();
    capture.text = await page.evaluate(() => document.body?.innerText ?? '');
    capture.html = await page.content();
    capture.links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: (a.textContent ?? '').trim().slice(0, 200),
      })),
    );
    capture.cookies = (await context.cookies()).map((c) => ({ name: c.name, domain: c.domain, path: c.path }));
  } catch (e) {
    capture.error = (e as Error).message.split('\n')[0];
  } finally {
    await page.close();
  }
  return capture;
}

/**
 * Visits a URL in headless Chromium and records each request and cookie from
 * the first load. It never clicks, types, scrolls or submits.
 */
export async function captureSite(url: string, opts: CaptureOptions): Promise<SiteCapture> {
  const ua = userAgent(opts.toolVersion);
  const ownBrowser = !opts.browser;
  const browser = opts.browser ?? (await (await loadChromium()).launch());
  const context = await browser.newContext({ userAgent: ua, locale: 'en-US' });
  try {
    if (opts.offline) {
      await context.route('**/*', (route) =>
        isLocalUrl(route.request().url())
          ? route.continue()
          : route.fulfill({ status: 200, contentType: 'text/plain', body: '' }),
      );
    }
    const timeout = opts.timeoutMs ?? 30_000;
    const offline = Boolean(opts.offline);
    const started = Date.now();
    let timedOut = false;
    const deadline =
      opts.deadlineMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            void context.close().catch(() => {});
          }, opts.deadlineMs);
    const pages: PageCapture[] = [];
    try {
      const start = await capturePage(context, url, timeout, offline);
      pages.push(start);
      if (!start.error) {
        for (const next of pickFollowLinks(start, (opts.maxPages ?? 5) - 1)) {
          if (timedOut || (opts.budgetMs !== undefined && Date.now() - started >= opts.budgetMs)) break;
          pages.push(await capturePage(context, next, timeout, offline));
        }
      }
    } catch (e) {
      if (!timedOut) throw e;
    } finally {
      clearTimeout(deadline);
    }
    if (timedOut) throw new Error(`The scan stopped after ${Math.round(opts.deadlineMs! / 1000)} s, the time limit for one scan.`);
    return { startUrl: url, userAgent: ua, pages };
  } finally {
    await context.close().catch(() => {});
    if (ownBrowser) await browser.close();
  }
}
