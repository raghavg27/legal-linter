import { defineRule, type ApplicabilityResult, type Intake } from '@legal-lint/core';
import fixYaml from './fix.yaml?raw';
import legalYaml from './legal.yaml?raw';
import { detectStatic } from './static.ts';

/** The intake's "hosts user uploads publicly" answer decides whether the rule applies. */
function applies(intake: Intake | null): ApplicabilityResult {
  const value = intake?.hostsPublicUploads;
  if (value === true) return { value: 'yes', reason: 'Intake: hosts user uploads publicly.' };
  if (value === false) return { value: 'no', reason: 'Intake: does not host user uploads publicly.' };
  return { value: 'unknown', reason: 'The intake does not say whether user uploads are hosted publicly.', missing: ['hostsPublicUploads'] };
}

export const ll05 = defineRule({
  meta: {
    id: 'LL-05',
    name: 'User uploads with no DMCA agent',
    law: '17 U.S.C. §512(c)(2)',
    regions: ['US'],
    phase: 1,
    fixType: 'partial',
    detection: ['static', 'intake'],
    topics: [
      'uploads',
      'user uploads',
      'image uploads',
      'file uploads',
      'user-generated content',
      'avatars',
      'comments',
      'user posts',
      'forum',
      'community',
      'marketplace listings',
      'uploadthing',
      's3',
      'cloudinary',
      'file storage',
      'supabase storage',
      'blob storage',
    ],
  },
  legalYaml,
  fixYaml,
  applies,
  detectStatic,
});
