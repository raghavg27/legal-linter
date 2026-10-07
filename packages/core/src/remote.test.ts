import { describe, expect, it } from 'vitest';
import { apiErrorSchema, licenceRequestSchema, licenceResponseSchema, scanResponseSchema, siteCaptureSchema } from './remote.ts';
import type { SiteCapture } from './types.ts';

const capture: SiteCapture = {
  startUrl: 'https://example.com/',
  userAgent: 'ua',
  pages: [
    {
      url: 'https://example.com/',
      finalUrl: 'https://example.com/',
      status: 200,
      requests: [{ url: 'https://fonts.googleapis.com/css2?family=Inter', method: 'GET', resourceType: 'stylesheet', msSinceNavigation: 12 }],
      cookies: [{ name: 'a', domain: 'example.com', path: '/' }],
      text: 'Hello',
      html: '<p>Hello</p>',
      links: [{ href: 'https://example.com/pricing', text: 'Pricing' }],
    },
    { url: 'https://example.com/x', finalUrl: 'https://example.com/x', status: null, requests: [], cookies: [], text: '', html: '', links: [], error: 'timeout' },
  ],
};

describe('wire format', () => {
  it('round-trips a capture unchanged', () => {
    expect(scanResponseSchema.parse(JSON.parse(JSON.stringify({ capture })))).toEqual({ capture });
  });

  it('rejects a capture with no pages or a missing field', () => {
    expect(siteCaptureSchema.safeParse({ ...capture, pages: [] }).success).toBe(false);
    const { html: _drop, ...page } = capture.pages[0]!;
    expect(siteCaptureSchema.safeParse({ ...capture, pages: [page] }).success).toBe(false);
  });

  it('accepts only key and version in a licence request', () => {
    expect(licenceRequestSchema.safeParse({ key: 'll_x', version: '0.1.0' }).success).toBe(true);
    expect(licenceRequestSchema.safeParse({ key: 'll_x', version: '0.1.0', path: '/repo' }).success).toBe(false);
  });

  it('parses both licence answers and an error body', () => {
    expect(licenceResponseSchema.parse({ valid: true, expiresAt: null })).toEqual({ valid: true, expiresAt: null });
    expect(licenceResponseSchema.parse({ valid: false, reason: 'revoked' })).toEqual({ valid: false, reason: 'revoked' });
    expect(licenceResponseSchema.safeParse({ valid: false, reason: 'nope' }).success).toBe(false);
    expect(apiErrorSchema.parse({ error: { reason: 'monthly_budget', message: 'm' } }).error.reason).toBe('monthly_budget');
  });
});
