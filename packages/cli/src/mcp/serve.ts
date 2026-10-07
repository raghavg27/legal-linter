import type { Transport } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { createServer, type ServerOptions } from './server.ts';

/**
 * Starts the MCP server. stdout carries protocol messages only; errors go to stderr.
 * Tests pass an in-memory transport so they run the same entry point as production.
 */
export function startServer(opts: ServerOptions, transport?: Transport): StdioServerHandle {
  return serveStdio(() => createServer(opts), {
    transport,
    onerror: (e) => process.stderr.write(`legal-lint mcp: ${e.message}\n`),
  });
}

export function serve(version: string): void {
  const handle = startServer({ version });
  process.on('SIGINT', () => void handle.close());
  process.on('SIGTERM', () => void handle.close());
}
