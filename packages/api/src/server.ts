import { Firestore } from '@google-cloud/firestore';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { readConfig } from './config.ts';
import { publicWebOnly, systemResolve } from './egress/target.ts';
import { FirestoreStore } from './firestore-store.ts';
import { createScanner } from './scan.ts';
import pkg from '../package.json' with { type: 'json' };

const config = readConfig(process.env);
const store = new FirestoreStore(new Firestore());
const scanner = await createScanner({
  policy: publicWebOnly,
  resolve: systemResolve,
  toolVersion: pkg.version,
  pageTimeoutMs: config.pageTimeoutMs,
  budgetMs: config.budgetMs,
  deadlineMs: config.deadlineMs,
});
const app = createApp({ keys: store, usage: store, scanner, policy: publicWebOnly, resolve: systemResolve, config });
const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8080) });

process.on('SIGTERM', () => {
  server.close();
  void scanner.close();
});
