import type { Evidence, RawFinding, SiteCapture } from '@legal-lint/core';
import { ARL_RISK, GAP, hasRecurringPrice, hasRenewalDisclosure } from './signals.ts';

/** Pages visited (the start page and followed pricing links) that show recurring prices without renewal terms. */
export function detectRuntime(site: SiteCapture): RawFinding[] {
  const evidence: Evidence[] = [];
  for (const page of site.pages) {
    if (page.error || !hasRecurringPrice(page.text) || hasRenewalDisclosure(page.text)) continue;
    evidence.push({ kind: 'absence', looked: [page.finalUrl], observed: GAP.page });
  }
  if (evidence.length === 0) return [];
  return [
    {
      key: new URL(site.startUrl).origin,
      confidence: 'medium',
      evidence,
      explanation: `The pricing shown to visitors has recurring prices but no text saying the plan renews automatically until cancelled, or how to cancel. ${ARL_RISK}`,
    },
  ];
}
