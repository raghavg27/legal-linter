import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/server.ts', admin: 'src/admin-main.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  // The bundle contains all code, but not the two packages that the container installs itself:
  // Playwright (with its browser) and Firestore (which loads proto files at runtime).
  noExternal: [/^@legal-lint\//, 'hono', /^hono\//, '@hono/node-server', 'zod', 'ipaddr.js'],
  external: ['playwright', '@google-cloud/firestore'],
});
