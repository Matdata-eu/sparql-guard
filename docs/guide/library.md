# Using it as a library

The rewriter can be used without the HTTP server, for example inside an existing Node.js API
or a custom gateway. The package exports everything from `src/index.ts`.

```sh
npm install @matdata/sparql-guard
```

```ts
import { PolicySet, rewriteQuery, AccessDenied, UnsupportedQuery } from '@matdata/sparql-guard';

// Load once; reload when the files change.
const policies = PolicySet.fromFiles(['policies.ttl']);

function guard(query: string, agent: string | null, groups: string[]): string {
  const policy = policies.resolve({ agent, groups });
  if (!policy) {
    throw new AccessDenied('No access policy applies to you');
  }
  return rewriteQuery(query, policy, { agent }).query;
}

try {
  const safe = guard('SELECT * WHERE { ?s ?p ?o } LIMIT 10', 'https://example.org/people/jan', ['staff']);
  // send `safe` to the store
} catch (error) {
  if (error instanceof AccessDenied) { /* 403 */ }
  if (error instanceof UnsupportedQuery) { /* 400 */ }
  throw error;
}
```

## API

### `PolicySet`

| Member | Description |
| --- | --- |
| `PolicySet.fromFiles(files, options?)` | Loads Turtle (`.ttl`) or TriG (`.trig`) files. |
| `PolicySet.fromSources([{ name, text }], options?)` | Loads policies from strings; `name` decides the syntax by extension. |
| `options.graphSpanningChecks` | See [configuration](../reference/configuration). Default `true`. |
| `resolve({ agent, groups })` | Returns the merged `EffectivePolicy` for a requester, or `null` if no policy applies. |
| `policies` | The parsed policies, e.g. for listing them. |

Loading throws `PolicyError` for unparsable files and for unsupported SHACL.

### `rewriteQuery(query, policy, options)`

| Argument | Description |
| --- | --- |
| `query` | The SPARQL query string. |
| `policy` | An `EffectivePolicy` from `PolicySet.resolve`. |
| `options.agent` | Agent IRI used for `sg:requestingAgent`, or `null`. |
| `options.sparqlVersion` | `'1.1'` (default) or `'1.2'`; see [SPARQL 1.2](./sparql-1-2). |
| `options.protocolDataset` | `{ default: string[], named: string[] }` from the protocol's `default-graph-uri` / `named-graph-uri` parameters; replaces the query's `FROM` clauses. |

Returns `{ query, form }`, where `form` is `select`, `ask`, `construct` or `describe`. A
`describe` query comes back as a `CONSTRUCT`.

Throws `UnsupportedQuery` (unparsable or unsafe to rewrite, HTTP 400) or `AccessDenied`
(updates, `SERVICE`, hidden paths, HTTP 403). Both carry a `status` property.

### `authenticate(headers, authConfig)`

Applies the [authentication](./authentication) rules to Node.js request headers and returns
`{ agent, groups }`, or throws `AuthError` (status 401).

### `createGuardServer(config, log?)`

Creates the HTTP server without starting it. Returns `{ server, reload, close }`; call
`server.listen(port)` yourself.

```ts
import { createGuardServer, loadConfig } from '@matdata/sparql-guard';

const guard = createGuardServer(loadConfig('sparql-guard.json'));
guard.server.listen(8080);
```
