import { chromium, type Browser } from 'playwright';
import { captureSite } from '@legal-lint/core/crawler';
import type { SiteCapture } from '@legal-lint/core';
import { startEgressProxy, type EgressProxy } from './egress/proxy.ts';
import type { Resolver, TargetPolicy } from './egress/target.ts';

/**
 * The third SSRF layer. The proxy setting of Playwright adds `<-loopback>` to
 * the bypass list. Thus localhost also goes through the proxy. These flags
 * prevent WebRTC and QUIC from sending data around the proxy.
 */
export const CHROMIUM_ARGS = ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-quic'];

export interface Scanner {
  scan(url: string): Promise<SiteCapture>;
  close(): Promise<void>;
  proxy: EgressProxy;
  /** Simulates a browser crash. */
  closeBrowserForTest(): Promise<void>;
}

export async function createScanner(opts: {
  policy: TargetPolicy;
  resolve: Resolver;
  toolVersion: string;
  pageTimeoutMs?: number;
  budgetMs?: number;
  /** Hard limit for one scan. Thus a frozen page cannot keep a position. */
  deadlineMs?: number;
}): Promise<Scanner> {
  const proxy = await startEgressProxy({ policy: opts.policy, resolve: opts.resolve });
  let browser: Promise<Browser> | null = null;

  // One browser for each instance. It starts at the first use, and again if it stops.
  const getBrowser = async (): Promise<Browser> => {
    if (browser) {
      const b = await browser;
      if (b.isConnected()) return b;
    }
    browser = chromium.launch({ proxy: { server: proxy.url }, args: CHROMIUM_ARGS }).catch((e: unknown) => {
      browser = null;
      throw e;
    });
    return browser;
  };

  return {
    proxy,
    async scan(url) {
      return captureSite(url, {
        browser: await getBrowser(),
        toolVersion: opts.toolVersion,
        timeoutMs: opts.pageTimeoutMs ?? 15_000,
        budgetMs: opts.budgetMs ?? 40_000,
        deadlineMs: opts.deadlineMs ?? 60_000,
      });
    },
    async closeBrowserForTest() {
      await (await browser)?.close();
    },
    async close() {
      await (await browser?.catch(() => null))?.close();
      await proxy.close();
    },
  };
}
