import type { Browser, BrowserContext } from 'playwright';
import type { CapturedRequest, PageCapture, SiteCapture } from '../types.ts';

export interface CaptureOptions {
  toolVersion: string;
  /** Navigation timeout per page. */
  timeoutMs?: number;
  /** Reuse a browser (tests share one). Otherwise one is launched and closed. */
  browser?: Browser;
  /**
   * Record requests to non-local hosts but answer them locally with an empty
   * response, so nothing leaves the machine. Used by the test suite.
   */
  offline?: boolean;
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

async function capturePage(context: BrowserContext, url: string, timeoutMs: number): Promise<PageCapture> {
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
    // Give late scripts (replay SDKs, tag managers) a moment, without waiting forever on chatty pages.
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
 * Visits a URL in headless Chromium and records every request and cookie from
 * first load. It never clicks, types, scrolls or submits anything.
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
    const page = await capturePage(context, url, opts.timeoutMs ?? 30_000);
    return { startUrl: url, userAgent: ua, pages: [page] };
  } finally {
    await context.close();
    if (ownBrowser) await browser.close();
  }
}
