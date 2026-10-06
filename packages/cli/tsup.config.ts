import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/bin.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  // core and rules are bundled in, so the published package is self-contained.
  noExternal: [/^@legal-lint\//],
  // Optional: only needed for URL scans, loaded with a dynamic import.
  external: ['playwright'],
  esbuildPlugins: [
    {
      // Rule data files are imported as `./legal.yaml?raw`; inline them as strings.
      name: 'raw-text',
      setup(build) {
        build.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, '')),
          namespace: 'raw-text',
        }));
        build.onLoad({ filter: /.*/, namespace: 'raw-text' }, async (args) => ({
          contents: await readFile(args.path, 'utf8'),
          loader: 'text',
        }));
      },
    },
  ],
});
