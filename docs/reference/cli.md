# Command line

```text
sparql-guard serve [--config sparql-guard.json]
sparql-guard rewrite --policies <file.ttl>... [--agent <iri>] [--group <name>]... [--sparql 1.1|1.2] <query.rq | ->
sparql-guard check --policies <file.ttl>...
sparql-guard hash-key <api-key>
```

When built from source, run it as `node dist/cli.js …`. In the container image the entry
point is the CLI, so `docker run sparql-guard check --policies /config/policies.ttl` works too.

## serve

Runs the proxy.

| Option | Description |
| --- | --- |
| `-c`, `--config` | Configuration file. Default: `SPARQL_GUARD_CONFIG`, then `sparql-guard.json`. |

Signals: `SIGHUP` reloads the policies, `SIGINT` / `SIGTERM` stop the server.

## rewrite

Prints the query that a given agent would send to the store. The matched policies are printed
on stderr as a comment.

| Option | Description |
| --- | --- |
| `-p`, `--policies` | Policy file; repeat for several. |
| `-a`, `--agent` | Agent IRI. Omit for an anonymous request. |
| `-g`, `--group` | Group; repeat for several. |
| `--sparql` | `1.1` (default) or `1.2`, like `sparqlVersion` in the configuration. |
| `<query.rq>` | File with the query, or `-` for stdin. |

```sh
echo 'SELECT * WHERE { ?s a <https://example.org/rail/vocab#WorkOrder> }' | \
  sparql-guard rewrite -p examples/railway/policies.ttl \
    -a urn:sparql-guard:user:jan -g maintenance-north -
```

Exits with status 1 and a message if no policy applies, or if the query is refused.

## check

Loads and compiles the policy files and prints one line per policy:

```text
<https://example.org/rail/policy/maintenance-north>: 4 graph(s), 3 visibility rule(s), 1 hidden-property rule(s)
```

Exits with status 1 on any error. Useful as a CI step for a repository of policies.

## hash-key

Prints the SHA-256 of a key, for `auth.apiKeys[].sha256`:

```sh
sparql-guard hash-key "$(openssl rand -hex 24)"
```
