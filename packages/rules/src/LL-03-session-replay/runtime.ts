import type { RawFinding, RuntimeEvidence, SiteCapture } from '@legal-lint/core';
import { SDKS } from './sdks.ts';

const CA_RISK =
  "Under California's Invasion of Privacy Act, recording visitors before telling them is the basis of class demand letters seeking statutory damages.";

/** One finding for each replay tool on the site, for all the visited pages together. */
export function detectRuntime(site: SiteCapture): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const sdk of SDKS) {
    const recording: RuntimeEvidence[] = [];
    const scripts: RuntimeEvidence[] = [];
    const seen = new Set<string>();
    for (const page of site.pages) {
      for (const req of page.requests) {
        let url: URL;
        try {
          url = new URL(req.url);
        } catch {
          continue;
        }
        const key = `${url.origin}${url.pathname}`;
        if (seen.has(key)) continue;
        const isRecording = sdk.recording(url);
        if (!isRecording && !sdk.script(url)) continue;
        seen.add(key);
        (isRecording ? recording : scripts).push({
          kind: 'runtime',
          pageUrl: page.finalUrl,
          requestUrl: req.url,
          resourceType: req.resourceType,
          msSinceNavigation: req.msSinceNavigation,
          observed: isRecording
            ? `Recording data sent to ${url.hostname} before any interaction`
            : `${sdk.name} recording script loaded before any interaction`,
        });
      }
    }
    if (recording.length === 0 && scripts.length === 0) continue;
    const sent = recording.length > 0;
    findings.push({
      key: `${new URL(site.startUrl).origin}#${sdk.name}`,
      confidence: sent ? 'high' : 'medium',
      evidence: [...scripts, ...recording].sort((a, b) => a.msSinceNavigation - b.msSinceNavigation).slice(0, 10),
      explanation: sent
        ? `On first load, before any click, the site sent session recording data to ${sdk.name}, so visitors are recorded before they are told. ${CA_RISK}`
        : `On first load, before any click, the site loaded ${sdk.name}'s recording script; no recording traffic was seen during the visit, but recording may start moments later. ${CA_RISK}`,
    });
  }
  return findings;
}
