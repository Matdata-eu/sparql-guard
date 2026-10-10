/** Works out who is asking. sparql-guard authorizes; authentication is delegated or key based. */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { AuthConfig } from './config.js';
import type { Requester } from './policy.js';

export class AuthError extends Error {
  public readonly status = 401;
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(',') : value;
}

function presentedKey(headers: IncomingHttpHeaders): string | undefined {
  const authorization = header(headers, 'authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }
  return header(headers, 'x-api-key')?.trim();
}

export function authenticate(headers: IncomingHttpHeaders, config: AuthConfig): Requester {
  const key = presentedKey(headers);
  if (key !== undefined && config.apiKeys) {
    const digest = Buffer.from(hashKey(key), 'hex');
    const match = config.apiKeys.find((k) => {
      const expected = Buffer.from(k.sha256.toLowerCase(), 'hex');
      return expected.length === digest.length && timingSafeEqual(expected, digest);
    });
    if (!match) {
      // Never fall back to anonymous when bad credentials are presented.
      throw new AuthError('Invalid API key');
    }
    return { agent: match.agent, groups: match.groups ?? [] };
  }

  const trusted = config.trustedHeaders;
  const user = trusted ? header(headers, trusted.agent)?.trim() : undefined;
  if (trusted && user) {
    const isIri = /^[a-z][a-z0-9+.-]*:/iu.test(user);
    const groups = trusted.groups ? header(headers, trusted.groups) : undefined;
    return {
      agent: isIri ? user : `${trusted.agentPrefix ?? 'urn:sparql-guard:user:'}${encodeURIComponent(user)}`,
      groups: groups ? groups.split(',').map(g => g.trim()).filter(g => g.length > 0) : [],
    };
  }

  if (config.anonymous) {
    return { agent: null, groups: [] };
  }
  throw new AuthError('Authentication required');
}
