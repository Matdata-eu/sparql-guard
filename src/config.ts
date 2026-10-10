/** Server configuration: a JSON file with `${ENV_VAR}` interpolation, plus a few env overrides. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface ApiKey {
  /** Hex SHA-256 of the key. Generate with `sparql-guard hash-key <key>`. */
  sha256: string;
  agent: string;
  groups?: string[];
}

export interface TrustedHeaders {
  /** Header carrying the authenticated user, set by an auth proxy in front of sparql-guard. */
  agent: string;
  /** Optional header with a comma-separated list of groups. */
  groups?: string;
  /** Prefix that turns a user name into an agent IRI. Values that already are IRIs are kept. */
  agentPrefix?: string;
}

export interface AuthConfig {
  apiKeys?: ApiKey[];
  trustedHeaders?: TrustedHeaders;
  /** Accept requests without credentials as the anonymous agent. */
  anonymous?: boolean;
}

export interface Config {
  /** SPARQL query endpoint of the store that is being protected. */
  upstream: string;
  /** Extra headers sent upstream, e.g. the proxy's own credentials for the store. */
  upstreamHeaders?: Record<string, string>;
  host?: string;
  port?: number;
  /** Path the SPARQL endpoint is served on. */
  path?: string;
  /** Turtle/TriG files holding the policies. */
  policies: string[];
  auth: AuthConfig;
  /** Evaluate policy checks across all graphs (safe default) or only in the active graph. */
  graphSpanningChecks?: boolean;
  /** Serve `<path>/explain`, which shows the rewritten query. */
  explain?: boolean;
  /** Reload the policies when a policy file changes. */
  watchPolicies?: boolean;
  /** Upstream request timeout in milliseconds. */
  timeoutMs?: number;
  /** SPARQL version accepted from clients and sent to the store. Use 1.2 when the data has triple terms. */
  sparqlVersion?: '1.1' | '1.2';
}

export function loadConfig(file: string): Config {
  const raw = readFileSync(file, 'utf8').replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu, (_, name: string) => {
    const value = process.env[name];
    if (value === undefined) {
      throw new Error(`Config ${file} refers to unset environment variable ${name}`);
    }
    return JSON.stringify(value).slice(1, -1);
  });
  const config = JSON.parse(raw) as Config;
  config.upstream = process.env.SPARQL_GUARD_UPSTREAM ?? config.upstream;
  if (process.env.PORT) {
    config.port = Number(process.env.PORT);
  }
  if (!config.upstream) {
    throw new Error('Config needs an "upstream" SPARQL endpoint');
  }
  if (!Array.isArray(config.policies) || config.policies.length === 0) {
    throw new Error('Config needs at least one file in "policies"');
  }
  const base = dirname(resolve(file));
  config.policies = config.policies.map(p => resolve(base, p));
  config.auth ??= {};
  if (config.sparqlVersion !== undefined && config.sparqlVersion !== '1.1' && config.sparqlVersion !== '1.2') {
    throw new Error('"sparqlVersion" must be "1.1" or "1.2"');
  }
  return config;
}
