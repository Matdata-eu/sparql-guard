# Getting started

This page puts sparql-guard in front of a SPARQL endpoint you already have. If you just
want to see it work, start with the [playground](./playground) instead.

## Requirements

- Node.js 20 or newer, or Docker.
- A SPARQL 1.1 query endpoint, for example `http://localhost:3030/ds/sparql`.
- Your data in **named graphs** if you want graph-level policies.

## 1. Install

Install the command line tool from npm:

```sh
npm install -g @matdata/sparql-guard
```

This gives you the `sparql-guard` command. To try it without installing, prefix the commands
on this page with `npx @matdata/sparql-guard` instead of `sparql-guard`.

Or use the container image, for `linux/amd64` and `linux/arm64`:

```sh
docker pull ghcr.io/matdata-eu/sparql-guard:latest
```

## 2. Write a first policy

Create `policies.ttl`. This policy lets everybody, including anonymous users, read a single
graph:

```turtle
@prefix sg: <https://matdata.eu/ns/sparql-guard#> .
@prefix ex: <https://example.org/> .

ex:public a sg:Policy ;
  sg:agent sg:Anyone ;
  sg:readGraph <https://example.org/graph/public> .
```

Check that it loads:

```sh
sparql-guard check --policies policies.ttl
```

```text
<https://example.org/public>: 1 graph(s), 0 visibility rule(s), 0 hidden-property rule(s)
```

## 3. Preview a rewrite

Before running a server, look at what a query turns into:

```sh
echo 'SELECT * WHERE { ?s ?p ?o } LIMIT 10' > query.rq
sparql-guard rewrite --policies policies.ttl query.rq
```

```sparql
SELECT ?o ?p ?s FROM <https://example.org/graph/public> FROM NAMED <https://example.org/graph/public> WHERE {
  ?s ?p ?o .
}
LIMIT 10
```

Pass `--agent <iri>` and `--group <name>` to see the query as a specific user would send it.

## 4. Configure the proxy

Create `sparql-guard.json` next to the policy file:

```json
{
  "upstream": "http://localhost:3030/ds/sparql",
  "port": 8080,
  "policies": ["policies.ttl"],
  "auth": { "anonymous": true },
  "explain": true
}
```

All options are listed in the [configuration reference](../reference/configuration).

## 5. Run it

```sh
sparql-guard serve --config sparql-guard.json
```

or with Docker, mounting the folder that holds both files:

```sh
docker run --rm -p 8080:8080 -v "$PWD:/config:ro" ghcr.io/matdata-eu/sparql-guard:latest
```

```text
Loaded 1 policies from /config/policies.ttl
sparql-guard listening on :8080/sparql -> http://localhost:3030/ds/sparql
```

::: tip Docker and localhost
Inside a container, `localhost` is the container itself. Use the store's service name on a
shared Docker network, or `host.docker.internal` on Docker Desktop.
:::

## 6. Query it

Any SPARQL client works. With curl:

```sh
curl -H 'Accept: application/sparql-results+json' \
  --data-urlencode 'query=SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }' \
  http://localhost:8080/sparql
```

The answer only counts triples in `https://example.org/graph/public`, even though the query
does not mention a graph.

## Next steps

- Add API keys or plug in your SSO: [Authentication](./authentication).
- Restrict rows, not only graphs: [Writing policies](./writing-policies).
- Run it on Kubernetes: [Deployment](./deployment).
