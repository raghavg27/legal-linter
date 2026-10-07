import { z } from 'zod';
import type { SiteCapture } from './types.ts';

// The data that goes between the CLI and the hosted API. The request schemas are
// strict. Thus nothing other than the key, the version and the URL can be added by accident.

export const siteCaptureSchema: z.ZodType<SiteCapture> = z.object({
  startUrl: z.string(),
  userAgent: z.string(),
  pages: z
    .array(
      z.object({
        url: z.string(),
        finalUrl: z.string(),
        status: z.number().int().nullable(),
        requests: z.array(z.object({ url: z.string(), method: z.string(), resourceType: z.string(), msSinceNavigation: z.number() })),
        cookies: z.array(z.object({ name: z.string(), domain: z.string(), path: z.string() })),
        text: z.string(),
        html: z.string(),
        links: z.array(z.object({ href: z.string(), text: z.string() })),
        error: z.string().optional(),
      }),
    )
    .min(1),
});

export const licenceRequestSchema = z.object({ key: z.string().min(1).max(200), version: z.string().min(1).max(50) }).strict();

export const licenceResponseSchema = z.union([
  z.object({ valid: z.literal(true), expiresAt: z.string().nullable() }),
  z.object({ valid: z.literal(false), reason: z.enum(['unknown', 'revoked', 'expired']) }),
]);

export const scanRequestSchema = z.object({ url: z.string().min(1).max(2048), version: z.string().min(1).max(50) }).strict();

export const scanResponseSchema = z.object({ capture: siteCaptureSchema });

export const API_ERROR_REASONS = [
  'bad_request',
  'bad_url',
  'private_address',
  'unauthorized',
  'too_many_requests',
  'key_hour',
  'key_day',
  'monthly_budget',
  'busy',
  'scan_failed',
  'internal',
] as const;

export const apiErrorSchema = z.object({ error: z.object({ reason: z.enum(API_ERROR_REASONS), message: z.string() }) });

export type LicenceResponse = z.infer<typeof licenceResponseSchema>;
export type ApiErrorReason = (typeof API_ERROR_REASONS)[number];
