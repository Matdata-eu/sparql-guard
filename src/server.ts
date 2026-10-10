/** The HTTP proxy: SPARQL 1.1 Protocol in, rewritten query out to the upstream store. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { unwatchFile, watchFile } from 'node:fs';
import { Readable } from 'node:stream';
import { authenticate, AuthError } from './auth.js';
import type { Config } from './config.js';
import { PolicySet } from './policy.js';
import { AccessDenied, rewriteQuery, UnsupportedQuery, type Dataset } from './rewrite.js';

const MAX_BODY = 1024 * 1024;

const DEFAULT_ACCEPT: Record<string, string> = {
  select: 'application/sparql-results+json',
  ask: 'application/sparql-results+json',
  construct: 'text/turtle',
  describe: 'text/turtle',
};

class HttpError extends Error {
  public constructor(public readonly status: number, message: string) {
    super(message);
  }
}

interface ProtocolRequest {
  query: string;
  dataset: Dataset;
}

export interface GuardServer {
  server: Server;
  reload: () => void;
  close: () => Promise<void>;
}

export function createGuardServer(config: Config, log: (line: string) => void = console.log): GuardServer {
  const loadPolicies = (): PolicySet =>
    PolicySet.fromFiles(config.policies, { graphSpanningChecks: config.graphSpanningChecks });
  let policies = loadPolicies();
  log(`Loaded ${policies.policies.length} policies from ${config.policies.join(', ')}`);

  const reload = (): void => {
    try {
      policies = loadPolicies();
      log(`Reloaded ${policies.policies.length} policies`);
    } catch (error) {
      // Keep serving with the last good policies rather than failing open or going down.
      log(`Policy reload failed, keeping previous policies: ${(error as Error).message}`);
    }
  };
  if (config.watchPolicies) {
    for (const file of config.policies) {
      watchFile(file, { interval: 2000 }, reload);
    }
  }

  const base = (config.path ?? '/sparql').replace(/\/$/u, '');

  const server = createServer((req, res) => {
    const started = Date.now();
    let agent = '-';
    handle(req, res).catch((error: unknown) => {
      const status = error instanceof HttpError || error instanceof AccessDenied ||
        error instanceof UnsupportedQuery || error instanceof AuthError ?
        error.status :
        502;
      if (!res.headersSent) {
        // CORS headers on errors too, so browser clients can read why a query was refused.
        res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...corsHeaders(req) });
        res.end(`${(error as Error).message}\n`);
      } else {
        res.destroy();
      }
    }).finally(() => {
      log(`${req.method} ${req.url?.split('?')[0]} ${agent} ${res.statusCode} ${Date.now() - started}ms`);
    });

    async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/healthz') {
        res.writeHead(200, { 'content-type': 'text/plain' }).end('ok\n');
        return;
      }
      const explain = config.explain && url.pathname === `${base}/explain`;
      if (url.pathname !== base && !explain) {
        throw new HttpError(404, 'Not found');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders(req)).end();
        return;
      }

      const requester = authenticate(req.headers, config.auth);
      agent = requester.agent ?? 'anonymous';
      const request = await readProtocolRequest(req, url);
      const policy = policies.resolve(requester);
      if (!policy) {
        throw new AccessDenied('No access policy applies to you');
      }
      const rewritten = rewriteQuery(request.query, policy, {
        agent: requester.agent,
        protocolDataset: request.dataset,
        sparqlVersion: config.sparqlVersion,
        pretty: explain,
      });

      if (explain) {
        res.writeHead(200, { 'content-type': 'application/json', ...corsHeaders(req) });
        res.end(JSON.stringify({ agent: requester.agent, groups: requester.groups, policies: policy.policies, ...rewritten }, null, 2));
        return;
      }

      const upstream = await fetch(config.upstream, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: req.headers.accept && req.headers.accept !== '*/*' ? req.headers.accept : DEFAULT_ACCEPT[rewritten.form],
          ...config.upstreamHeaders,
        },
        body: new URLSearchParams({ query: rewritten.query }).toString(),
        signal: AbortSignal.timeout(config.timeoutMs ?? 60_000),
      });
      const headers: Record<string, string> = { ...corsHeaders(req) };
      // fetch() already decoded any content-encoding, so that header is not forwarded.
      for (const name of ['content-type', 'cache-control']) {
        const value = upstream.headers.get(name);
        if (value) {
          headers[name] = value;
        }
      }
      res.writeHead(upstream.status, headers);
      if (upstream.body) {
        Readable.fromWeb(upstream.body as never).pipe(res);
        await new Promise<void>((resolve, reject) => {
          res.on('finish', resolve);
          res.on('close', resolve);
          res.on('error', reject);
        });
      } else {
        res.end();
      }
    }
  });

  return {
    server,
    reload,
    close: () => new Promise((resolve) => {
      config.policies.forEach(f => unwatchFile(f));
      server.close(() => resolve());
    }),
  };
}

function corsHeaders(req: IncomingMessage): Record<string, string> {
  return {
    'access-control-allow-origin': req.headers.origin ?? '*',
    'access-control-allow-headers': 'authorization, content-type, accept, x-api-key',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    vary: 'origin',
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) {
      throw new HttpError(413, 'Request body too large');
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Reads a query according to the SPARQL 1.1 Protocol (GET, POST form, POST direct). */
async function readProtocolRequest(req: IncomingMessage, url: URL): Promise<ProtocolRequest> {
  let params = url.searchParams;
  let query: string | null;
  if (req.method === 'GET') {
    query = params.get('query');
  } else if (req.method === 'POST') {
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const body = await readBody(req);
    if (type === 'application/sparql-update') {
      throw new AccessDenied('SPARQL Update is not allowed through this endpoint');
    }
    if (type === 'application/sparql-query') {
      query = body;
    } else if (type === 'application/x-www-form-urlencoded') {
      params = new URLSearchParams(body);
      query = params.get('query');
    } else {
      throw new HttpError(415, `Unsupported content type ${type}`);
    }
  } else {
    throw new HttpError(405, 'Method not allowed');
  }
  if (params.has('update')) {
    throw new AccessDenied('SPARQL Update is not allowed through this endpoint');
  }
  if (!query) {
    throw new HttpError(400, 'Missing query');
  }
  return {
    query,
    dataset: { default: params.getAll('default-graph-uri'), named: params.getAll('named-graph-uri') },
  };
}
