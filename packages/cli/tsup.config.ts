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
  // core and rules are in the bundle. Thus the published package does not need other workspace packages.
  noExternal: [/^@legal-lint\//],
  // Optional: only URL scans need it. It loads with a dynamic import.
  external: ['playwright'],
  esbuildPlugins: [
    {
      // Rule data files are imported as `./legal.yaml?raw`. Put them in the bundle as strings.
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
