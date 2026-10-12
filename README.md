# sparql-guard

**Documentation: <https://matdata-eu.github.io/sparql-guard/>** · **[Live demo](https://matdata-eu.github.io/sparql-guard/demo/)**

A store-neutral access-control proxy for SPARQL endpoints.

Fine-grained access control for RDF exists today only *inside* individual triple stores
(Virtuoso ACLs, GraphDB, Stardog, …), each with its own model, or in academic papers.
sparql-guard puts it in front of **any** SPARQL 1.1 endpoint instead: it authenticates the
caller, looks up the policies that apply, **rewrites the query** so that it can only see what
those policies allow, and forwards the rewritten query to the store.

- **Graph-level policies** — which named graphs an agent or group may read.
- **Row-level policies written in SHACL** — "an employee is visible only if it belongs to the
  sales department", "documents are visible only to their owner", "nobody in this group sees
  salaries". Shapes you already know, no new rule language.
- **Query rewriting, not result filtering** — aggregates, `FILTER EXISTS`, `MINUS`, `OPTIONAL`,
  sub-queries and `CONSTRUCT` all evaluate over the restricted view, so counts and joins can
  not leak hidden data. Parsing, algebra and generation are done with
  [Traqula](https://github.com/comunica/traqula).
- **SPARQL 1.2** — reifiers, annotations and triple terms are supported, and a triple term
  is only visible when the triple it carries is.
- **Fails closed** — unsupported SHACL in a policy stops the proxy from starting; queries that
  cannot be rewritten safely (`SERVICE`, updates, transitive paths over restricted data, …) are
  refused, never passed through.

```text
client ──► sparql-guard ──► any SPARQL 1.1 endpoint
           authenticate         (Fuseki, GraphDB, Virtuoso, Stardog, Oxigraph, QLever, …)
           resolve policies
           rewrite query
```

## Playground

```sh
docker compose up --build
```

Then open <http://localhost:8095>. The stack runs an Oxigraph store with fictional railway data
(network, track assets, maintenance work orders, timetable, incidents, staff) behind
sparql-guard, and a query UI where you pick a role and run your own queries:

| Role | Credentials | Sees |
| --- | --- | --- |
| Anonymous | none | the public network |
| ACME Rail dispatcher | `Bearer acme-key` | network + timetable, only ACME's train paths |
| Jan, maintenance north | `Bearer jan-key` | assets, work orders and staff of the north region, plus his own record; no salary scales |
| Els, maintenance south | `Bearer els-key` | the same for the south region |
| Safety analyst | `Bearer safety-key` | incidents, assets, timetable; no driver identities, statements or cabinet codes |
| Administrator | `Bearer admin-key` | everything |
| Custom | `x-forwarded-user` / `x-forwarded-groups` | whatever the policies give that user and those groups |

"Show rewritten query" displays what the store actually receives. The roles live in
[examples/railway/policies.ttl](examples/railway/policies.ttl); edits are picked up while the
stack runs. The unguarded store is on <http://localhost:7879> for comparison. Ports can be
changed with `SG_UI_PORT` and `SG_STORE_PORT`.

## Quick start

```sh
npm install -g @matdata/sparql-guard

# See what a query becomes for a member of the "sales" group:
sparql-guard rewrite --policies examples/policies.ttl \
  --agent urn:sparql-guard:user:alice --group sales query.rq

# Run the proxy (edit "upstream" in the config first):
sparql-guard serve --config examples/sparql-guard.json
```

The package also works as a library: `import { PolicySet, rewriteQuery } from '@matdata/sparql-guard'`.

Then query `http://localhost:8080/sparql` with any SPARQL client, using the standard
SPARQL 1.1 Protocol (GET, POST form, or POST `application/sparql-query`).

## A policy

Policies are RDF (Turtle or TriG). A policy says who it applies to, which graphs they may read,
and — optionally — SHACL shapes that restrict which resources and properties are visible.

```turtle
@prefix sg:  <https://matdata.eu/ns/sparql-guard#> .
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix ex:  <https://example.org/> .

ex:salesPolicy a sg:Policy ;
  sg:group "sales" ;
  sg:readGraph <https://example.org/graph/public>, <https://example.org/graph/hr> ;
  sg:visibleIf ex:SalesEmployeesOnly, ex:OwnDocumentsOnly ;
  sg:hideProperties ex:NoSalaries .

# Employees (incl. subclasses) are visible only when they are in Sales.
ex:SalesEmployeesOnly a sh:NodeShape ;
  sh:targetClass ex:Employee ;
  sh:property [ sh:path ex:department ; sh:hasValue ex:Sales ] .

# Documents are visible only to the agent that owns them.
ex:OwnDocumentsOnly a sh:NodeShape ;
  sh:targetClass ex:Document ;
  sh:property [ sh:path ex:owner ; sh:hasValue sg:requestingAgent ] .

# Salaries of employees are never shown.
ex:NoSalaries a sh:NodeShape ;
  sh:targetClass ex:Employee ;
  sh:property [ sh:path ex:salary ] .
```

A resource that is a target of a `sg:visibleIf` shape but does **not conform** to it is hidden:
every triple with it as subject (and, by default, as object) disappears from the agent's view.
See the [policy language reference](https://matdata-eu.github.io/sparql-guard/reference/policy-language)
for the full vocabulary and the supported SHACL subset, and [examples/](examples) for runnable setups.

## Configuration

```json
{
  "upstream": "http://fuseki:3030/ds/sparql",
  "upstreamHeaders": { "Authorization": "Basic ${STORE_CREDENTIALS}" },
  "port": 8080,
  "path": "/sparql",
  "policies": ["policies.ttl"],
  "auth": {
    "apiKeys": [{ "sha256": "…", "agent": "https://example.org/people/alice", "groups": ["sales"] }],
    "trustedHeaders": { "agent": "x-forwarded-user", "groups": "x-forwarded-groups" },
    "anonymous": true
  },
  "graphSpanningChecks": true,
  "explain": false,
  "watchPolicies": true,
  "timeoutMs": 60000
}
```

| Key | Meaning |
| --- | --- |
| `upstream` | Query endpoint of the protected store. Override with `SPARQL_GUARD_UPSTREAM`. |
| `upstreamHeaders` | Headers for the store, e.g. the proxy's own credentials. `${VAR}` reads environment variables. |
| `policies` | Turtle/TriG policy files, relative to the config file. |
| `auth.apiKeys` | Bearer / `X-API-Key` keys, stored as SHA-256 (`sparql-guard hash-key <key>`). |
| `auth.trustedHeaders` | Identity set by an authenticating reverse proxy (oauth2-proxy, an ingress, …). Only enable this when clients cannot reach sparql-guard directly. |
| `auth.anonymous` | Accept requests without credentials as the anonymous agent. |
| `graphSpanningChecks` | Evaluate policy checks across all readable graphs (safe default). Set to `false` only if all data about a resource lives in one graph; queries get faster. |
| `explain` | Serve `<path>/explain`, which returns the rewritten query as JSON. Useful while writing policies; it reveals policy details to callers. |
| `watchPolicies` | Reload policy files when they change (also on `SIGHUP`). A broken file keeps the previous policies active. |

sparql-guard only **reads**: SPARQL Update is always refused. Put it in front of a read-only
endpoint and keep the store itself unreachable for clients.

## Container

Images for `linux/amd64` and `linux/arm64` are published to the GitHub Container Registry on
every push to `main` (`latest`, `main`) and for every `v*` tag (`1.2.3`, `1.2`):

```sh
docker pull ghcr.io/matdata-eu/sparql-guard:latest
```

To build it yourself:

```sh
docker build -t sparql-guard .
docker run --rm -p 8080:8080 -v "$PWD/examples:/config:ro" \
  -e SPARQL_GUARD_UPSTREAM=http://my-store:3030/ds/sparql ghcr.io/matdata-eu/sparql-guard:latest
```

The image expects `/config/sparql-guard.json` (override with `SPARQL_GUARD_CONFIG`). On
Kubernetes, mount the config and policies from a ConfigMap; with `watchPolicies` the proxy
picks up changes without a restart. Health check: `GET /healthz`.

## How the rewrite works

The query is parsed and translated to SPARQL algebra with Traqula. Then:

1. **Dataset.** `FROM` / `FROM NAMED` (and the protocol's `default-graph-uri` /
   `named-graph-uri`) are intersected with the readable graphs. Without a dataset clause the
   default graph becomes the union of the readable graphs.
2. **Shapes to filters.** Each SHACL shape was compiled to a SPARQL expression when the policies
   were loaded. Every basic graph pattern and property path in the query, including those
   inside `FILTER EXISTS`, `OPTIONAL`, `MINUS` and sub-queries, gets a `FILTER` that checks its
   subject and object against those expressions and drops hidden properties.
3. **Leaky forms.** `DESCRIBE` becomes an explicit `CONSTRUCT` of the visible triples, because a
   store's own `DESCRIBE` would return everything it knows. `SERVICE`, updates, reserved
   variable names and paths that cannot be checked are refused.
4. The algebra is turned back into SPARQL and sent upstream.

The limits of this approach are written down in the
[security model](https://matdata-eu.github.io/sparql-guard/guide/security-model).

## Development

```sh
npm test            # Vitest; runs rewritten queries against an in-memory Oxigraph store
npm run typecheck
npm run build
npm run docs:dev    # documentation site at http://localhost:5173/sparql-guard/
```

## License

Apache-2.0
