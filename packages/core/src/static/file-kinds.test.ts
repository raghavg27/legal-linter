import { describe, expect, it } from 'vitest';
import { fileKind, isNonShippingFile } from './file-kinds.ts';

describe('isNonShippingFile', () => {
  it.each([
    'src/__tests__/fonts.tsx',
    'tests/e2e.ts',
    'src/fonts.test.ts',
    'src/Button.stories.tsx',
    'test-all.mjs',
    'scripts/test_urls.js',
    'pkg/fonts_test.ts',
    'public/vendor/jquery.min.js',
  ])('skips %s', (file) => expect(isNonShippingFile(file)).toBe(true));

  it.each(['src/app/layout.tsx', 'pages/_document.tsx', 'src/latest-posts.ts', 'src/contest.tsx', 'src/attest.ts'])(
    'keeps %s',
    (file) => expect(isNonShippingFile(file)).toBe(false),
  );
});

describe('fileKind', () => {
  it.each([
    ['a.tsx', 'script'],
    ['a.mjs', 'script'],
    ['a.d.ts', 'other'],
    ['a.css', 'css'],
    ['a.scss', 'scss'],
    ['a.vue', 'markup'],
    ['a.html', 'markup'],
    ['a.woff2', 'other'],
  ])('%s is %s', (file, kind) => expect(fileKind(file)).toBe(kind));
});
