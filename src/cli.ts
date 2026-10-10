#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { hashKey } from './auth.js';
import { loadConfig } from './config.js';
import { PolicySet } from './policy.js';
import { rewriteQuery } from './rewrite.js';
import { createGuardServer } from './server.js';

const USAGE = `sparql-guard: access-control proxy for SPARQL endpoints

Usage:
  sparql-guard serve [--config sparql-guard.json]
  sparql-guard rewrite --policies <file.ttl>... [--agent <iri>] [--group <name>]... [--sparql 1.1|1.2] <query.rq | ->
  sparql-guard check --policies <file.ttl>...
  sparql-guard hash-key <api-key>

Commands:
  serve      Run the proxy (config path also via SPARQL_GUARD_CONFIG).
  rewrite    Print the query an agent would actually send upstream.
  check      Load and compile the policies, report problems.
  hash-key   Print the SHA-256 to put in auth.apiKeys[].sha256.
`;

function main(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c' },
      policies: { type: 'string', short: 'p', multiple: true },
      agent: { type: 'string', short: 'a' },
      group: { type: 'string', short: 'g', multiple: true },
      sparql: { type: 'string', default: '1.1' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    process.stdout.write(USAGE);
    return;
  }

  switch (command) {
    case 'serve': {
      const config = loadConfig(values.config ?? process.env.SPARQL_GUARD_CONFIG ?? 'sparql-guard.json');
      const guard = createGuardServer(config);
      const port = config.port ?? 8080;
      guard.server.listen(port, config.host ?? '0.0.0.0', () => {
        console.log(`sparql-guard listening on :${port}${config.path ?? '/sparql'} -> ${config.upstream}`);
      });
      process.on('SIGHUP', guard.reload);
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.on(signal, () => void guard.close().then(() => process.exit(0)));
      }
      return;
    }
    case 'rewrite': {
      const policies = PolicySet.fromFiles(requirePolicies(values.policies));
      const file = rest[0] ?? '-';
      const query = readFileSync(file === '-' ? 0 : file, 'utf8');
      const requester = { agent: values.agent ?? null, groups: values.group ?? [] };
      const policy = policies.resolve(requester);
      if (!policy) {
        throw new Error('No policy applies to this agent; every query would be refused');
      }
      process.stderr.write(`# policies: ${policy.policies.join(', ')}\n`);
      if (values.sparql !== '1.1' && values.sparql !== '1.2') {
        throw new Error('--sparql must be 1.1 or 1.2');
      }
      const rewritten = rewriteQuery(query, policy, { agent: requester.agent, sparqlVersion: values.sparql });
      process.stdout.write(`${rewritten.query}\n`);
      return;
    }
    case 'check': {
      const policies = PolicySet.fromFiles(requirePolicies(values.policies));
      for (const p of policies.policies) {
        const graphs = p.graphs === 'all' ? 'all graphs' : `${p.graphs.length} graph(s)`;
        console.log(`${p.id}: ${graphs}, ${p.visibility.length} visibility rule(s), ${p.hiddenProperties.length} hidden-property rule(s)`);
      }
      return;
    }
    case 'hash-key': {
      if (!rest[0]) {
        throw new Error('hash-key needs the key as argument');
      }
      console.log(hashKey(rest[0]));
      return;
    }
    default:
      throw new Error(`Unknown command ${command}\n\n${USAGE}`);
  }
}

function requirePolicies(files: string[] | undefined): string[] {
  if (!files || files.length === 0) {
    throw new Error('--policies is required');
  }
  return files;
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
}
