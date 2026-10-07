import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { bareHost, vetHost, type Resolver, type TargetPolicy } from './target.ts';

export interface EgressProxy {
  /** http://127.0.0.1:<port>, for the proxy setting of Chromium. */
  url: string;
  /** host:port of each refused connection, for tests and logs. */
  refused: string[];
  close(): Promise<void>;
}

/** "example.com:443" or "[::1]:443". */
function splitAuthority(authority: string): { host: string; port: number } | null {
  const m = /^(?:\[([^\]]+)\]|([^:\s]+)):(\d{1,5})$/.exec(authority);
  if (!m) return null;
  return { host: m[1] ?? m[2]!, port: Number(m[3]) };
}

function hostPort(host: string, port: number): string {
  const bare = bareHost(host);
  return net.isIPv6(bare) ? `[${bare}]:${port}` : `${bare}:${port}`;
}

/**
 * The second SSRF layer. Each connection that Chromium makes (navigations,
 * redirects, subresources, iframes, websockets) goes through this proxy. The
 * proxy resolves the name itself, checks each address, and connects to the
 * address that it checked.
 */
export async function startEgressProxy(opts: { policy: TargetPolicy; resolve: Resolver }): Promise<EgressProxy> {
  const refused: string[] = [];
  const sockets = new Set<net.Socket>();
  const track = (s: net.Socket) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  };
  const vet = async (host: string, port: number) => {
    const result = await vetHost(host, port, opts.policy, opts.resolve);
    if (!result.ok) refused.push(hostPort(host, port));
    return result;
  };

  // Plain http:// requests come with an absolute URL.
  const server = http.createServer(async (req, res) => {
    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== 'http:') {
      res.writeHead(400).end();
      return;
    }
    const port = target.port ? Number(target.port) : 80;
    const vetted = await vet(target.hostname, port);
    if (!vetted.ok) {
      res.writeHead(403).end();
      return;
    }
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    const upstream = http.request({
      host: vetted.address,
      port,
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers,
      setHost: false,
    });
    upstream.on('response', (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });

  const tunnel = async (host: string, port: number, client: net.Socket, onOpen: (upstream: net.Socket) => void) => {
    track(client);
    client.on('error', () => client.destroy());
    const vetted = await vet(host, port);
    if (!vetted.ok) {
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const upstream = net.connect(port, vetted.address, () => {
      onOpen(upstream);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    track(upstream);
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.destroy());
  };

  // https:// and wss:// (and ws:// in Chromium) come as CONNECT host:port.
  server.on('connect', (req, client: net.Socket, head: Buffer) => {
    const authority = splitAuthority(req.url ?? '');
    if (!authority) {
      client.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    void tunnel(authority.host, authority.port, client, (upstream) => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
    });
  });

  // ws:// sent as an upgrade request with an absolute URL: send it again to the checked address.
  server.on('upgrade', (req, client: net.Socket, head: Buffer) => {
    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      client.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    const port = target.port ? Number(target.port) : 80;
    void tunnel(target.hostname, port, client, (upstream) => {
      const lines = [`${req.method} ${target.pathname}${target.search} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        if (req.rawHeaders[i]!.toLowerCase() !== 'proxy-connection') lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
    });
  });

  server.on('connection', track);
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    refused,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
