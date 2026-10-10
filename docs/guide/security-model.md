# Security model

sparql-guard enforces read access by rewriting queries. This page says what that guarantees,
what it relies on, and where the limits are.

## What a rewritten query sees

For an agent with effective policy *P*, the rewritten query is the user's query evaluated over
a **view** of the store:

1. only the graphs *P* grants (or the store's dataset with `sg:readAllGraphs`);
2. within them, only triples whose subject is visible, whose object is visible (unless
   `sg:hideReferences false`) and whose predicate is not hidden for that subject.

"Visible" is decided by the SHACL shapes against **all readable graphs**, not the view: a
resource whose type triple sits in another readable graph is still recognised as a target.
Data in graphs the agent may not read is invisible to the checks as well. If the class
hierarchy or a resource's type is only stored in such a graph, the shape does not match the
resource and does not hide it. Policies should grant the graphs their shapes depend on.

Because the filters are attached to every basic graph pattern and path in the algebra, also
inside `FILTER EXISTS`, `MINUS`, `OPTIONAL`, sub-queries and aggregates, the answers are those
of the user's query over the view. Counts, joins and existence tests do not reveal hidden
triples.

## Assumptions

- **Clients cannot reach the store directly.** sparql-guard is the only path to the data.
  Give the store credentials only to the proxy (`upstreamHeaders`).
- **Trusted headers are set by your auth proxy.** With `auth.trustedHeaders`, anyone who can
  reach sparql-guard directly can claim any identity. Only enable it behind a proxy that
  authenticates users and overwrites those headers.
- **The store implements SPARQL 1.1 dataset clauses** (`FROM`, `FROM NAMED`) faithfully. Test
  your store with `sparql-guard rewrite` and the `/explain` endpoint before relying on graph
  restrictions. Known pitfall: Oxigraph started with `--union-default-graph` ignores `FROM`
  and answers from all graphs, so graph-level policies have no effect. Run it without that flag.

## What is refused

| Construct | Why |
| --- | --- |
| SPARQL Update, `application/sparql-update`, `update=` | The proxy is read-only. |
| `SERVICE` | Federated sub-queries would run outside the policy, possibly with the store's credentials. |
| Variables named `?__sg_…` | Reserved for the injected checks; a user binding could change their meaning. |
| `*` and `+` paths under `sg:visibleIf` rules | Intermediate nodes of a transitive path cannot be checked, so the path could traverse hidden resources. Opt in with `sg:allowTransitivePaths true`. |
| Paths that include a hidden property, negated property sets when properties are hidden | Which predicate matched cannot be checked. |
| `FROM` / `FROM NAMED` with `sg:readAllGraphs` and row-level rules | The checks must see all graphs, which cannot be listed in a dataset clause. Use `GRAPH` instead. |

`DESCRIBE` is not refused, but rewritten to a `CONSTRUCT` of the resource's outgoing visible
triples; store-specific `DESCRIBE` behaviour (e.g. concise bounded descriptions that follow
blank nodes) is not reproduced.

## Known limits

- **Timing and cost.** A query's run time can still depend on hidden data. Rate-limit and set
  `timeoutMs` if that matters.
- **Error messages from the store** are passed to the client unchanged.
- **Property paths** are checked at their end points. `?` and alternatives of plain links are
  safe; sequences are expanded into checked triple patterns by the algebra.
- **Performance.** Each pattern gets `NOT EXISTS` checks, and with `graphSpanningChecks` each
  check looks in every graph. Stores with good `EXISTS` optimisation (most do) handle this well;
  very large unions of graphs can be slow. If all triples about a resource live in one graph,
  set `graphSpanningChecks: false`.
- **Blank nodes** in the store cannot be targeted by `sh:targetNode`, and the visibility of a
  blank node is decided like any other resource.
