import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashKey } from '../src/auth.js';
import { createGuardServer, type GuardServer } from '../src/server.js';
import { examples, Harness } from './helpers.js';

/** A stand-in for the protected store: Oxigraph behind a minimal SPARQL protocol endpoint. */
function fakeStore(): { server: Server; received: string[] } {
  const store = Harness.example().store;
  const received: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      const query = new URLSearchParams(body).get('query') ?? '';
      received.push(query);
      const out = store.query(query, { results_format: 'application/sparql-results+json' });
      res.writeHead(200, { 'content-type': 'application/sparql-results+json' }).end(out);
    });
  });
  return { server, received };
}

const listen = (server: Server): Promise<string> => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
});

describe('HTTP proxy', () => {
  const upstream = fakeStore();
  let guard: GuardServer;
  let base: string;

  beforeAll(async () => {
    const upstreamUrl = await listen(upstream.server);
    guard = createGuardServer({
      upstream: `${upstreamUrl}/sparql`,
      policies: [examples('policies.ttl')],
      explain: true,
      auth: {
        apiKeys: [{ sha256: hashKey('alice-key'), agent: 'urn:sparql-guard:user:alice', groups: ['sales'] }],
        trustedHeaders: { agent: 'x-forwarded-user', groups: 'x-forwarded-groups' },
        anonymous: true,
      },
    }, () => {});
    base = `${await listen(guard.server)}/sparql`;
  });

  afterAll(async () => {
    await guard.close();
    upstream.server.close();
  });

  const names = async (res: Response): Promise<string[]> => {
    const json = await res.json() as { results: { bindings: { n: { value: string } }[] } };
    return json.results.bindings.map(b => b.n.value).sort();
  };
  const QUERY = 'SELECT ?n WHERE { ?e <https://example.org/name> ?n }';

  it('answers GET requests with the anonymous view', async () => {
    const res = await fetch(`${base}?query=${encodeURIComponent(QUERY)}`);
    expect(res.status).toBe(200);
    expect(await names(res)).toEqual(['ACME']);
  });

  it('answers POST requests with the API key holder\'s view', async () => {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/sparql-query', authorization: 'Bearer alice-key' },
      body: QUERY,
    });
    expect(await names(res)).toEqual(['ACME', 'Alice', 'Carol']);
  });

  it('uses the identity from trusted headers', async () => {
    // sg:readAllGraphs leaves the dataset to the store; Oxigraph's default graph is empty here.
    const query = 'SELECT ?n WHERE { GRAPH ?g { ?e <https://example.org/name> ?n } }';
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-user': 'hilde', 'x-forwarded-groups': 'hr-admins' },
      body: new URLSearchParams({ query }).toString(),
    });
    expect(await names(res)).toEqual(['ACME', 'Alice', 'Bob', 'Carol']);
  });

  it('rejects a wrong API key instead of falling back to anonymous', async () => {
    const res = await fetch(`${base}?query=${encodeURIComponent(QUERY)}`, { headers: { authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  it('refuses updates without contacting the store', async () => {
    const before = upstream.received.length;
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/sparql-update' },
      body: 'DROP ALL',
    });
    expect(res.status).toBe(403);
    expect(upstream.received.length).toBe(before);
  });

  it('lets browsers read error responses (CORS)', async () => {
    const res = await fetch(`${base}?query=${encodeURIComponent('SELECT * WHERE { SERVICE <http://x/> { ?s ?p ?o } }')}`, {
      headers: { origin: 'https://example.github.io' },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://example.github.io');
  });

  it('only ever sends rewritten queries upstream', async () => {
    await fetch(`${base}?query=${encodeURIComponent(QUERY)}`);
    expect(upstream.received.at(-1)).toContain('FROM <https://example.org/graph/public>');
  });

  it('explains the rewrite', async () => {
    const res = await fetch(`${base}/explain?query=${encodeURIComponent(QUERY)}`, { headers: { authorization: 'Bearer alice-key' } });
    const body = await res.json() as { policies: string[]; query: string };
    expect(body.policies).toContain('<https://example.org/policy/sales>');
    expect(body.query).toContain('NOT EXISTS');
  });
});
