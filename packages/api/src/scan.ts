import { chromium, type Browser } from 'playwright';
import { captureSite } from '@legal-lint/core/crawler';
import type { SiteCapture } from '@legal-lint/core';
import { startEgressProxy, type EgressProxy } from './egress/proxy.ts';
import type { Resolver, TargetPolicy } from './egress/target.ts';

/**
 * The third SSRF layer. Playwright's proxy setting adds `<-loopback>` to the
 * bypass list, so localhost also goes through the proxy. These flags keep
 * WebRTC and QUIC from sending anything around it.
 */
export const CHROMIUM_ARGS = ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-quic'];

export interface Scanner {
  scan(url: string): Promise<SiteCapture>;
  close(): Promise<void>;
  proxy: EgressProxy;
  /** Simulates a crashed browser. */
  closeBrowserForTest(): Promise<void>;
}

export async function createScanner(opts: {
  policy: TargetPolicy;
  resolve: Resolver;
  toolVersion: string;
  pageTimeoutMs?: number;
  budgetMs?: number;
  /** Hard limit for one scan, so a frozen page cannot hold a slot. */
  deadlineMs?: number;
}): Promise<Scanner> {
  const proxy = await startEgressProxy({ policy: opts.policy, resolve: opts.resolve });
  let browser: Promise<Browser> | null = null;

  // One browser per instance, launched on first use and again if it dies.
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
