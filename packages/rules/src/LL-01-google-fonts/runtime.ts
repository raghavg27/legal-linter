import type { RawFinding, RuntimeEvidence, SiteCapture } from '@legal-lint/core';
import { FONT_HOSTS } from './hosts.ts';

const MAX_EVIDENCE = 10;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function detectRuntime(site: SiteCapture): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const page of site.pages) {
    const seen = new Set<string>();
    const evidence: RuntimeEvidence[] = [];
    for (const req of page.requests) {
      const host = hostOf(req.url);
      if (!host || !FONT_HOSTS.has(host) || seen.has(req.url)) continue;
      seen.add(req.url);
      evidence.push({
        kind: 'runtime',
        pageUrl: page.finalUrl,
        requestUrl: req.url,
        resourceType: req.resourceType,
        msSinceNavigation: req.msSinceNavigation,
        observed: `Request to ${host} before any interaction`,
      });
    }
    if (evidence.length === 0) continue;

    const pageUrl = new URL(page.finalUrl);
    findings.push({
      key: `${pageUrl.origin}${pageUrl.pathname}`,
      confidence: 'high',
      evidence: evidence.slice(0, MAX_EVIDENCE),
      explanation:
        `On first load, before any click, this page requested ${evidence.length} ${evidence.length === 1 ? 'file' : 'files'} from Google's font servers, so the visitor's browser sent its IP address to Google before any consent. ` +
        'For EU visitors, this is the pattern behind the 2022 Munich court ruling and the wave of warning letters that followed.',
    });
  }
  return findings;
}
