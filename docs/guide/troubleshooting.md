# Troubleshooting

## Start with the rewritten query

Almost every question about what a user does or does not see is answered by the query that
reaches the store:

```sh
sparql-guard rewrite --policies policies.ttl --agent <iri> --group <name> query.rq
```

or, with `"explain": true`, send the same request to `/sparql/explain` with the user's own
credentials. The response also lists the agent, the groups and the policies that matched.

## Errors

| Status | Message | Cause and fix |
| --- | --- | --- |
| 401 | `Authentication required` | No credentials, and `auth.anonymous` is off. |
| 401 | `Invalid API key` | The key does not match any `sha256` in `auth.apiKeys`. Hash it again with `sparql-guard hash-key`. |
| 403 | `No access policy applies to you` | No `sg:Policy` matches the agent or its groups. Check the agent IRI and groups in the explain output. |
| 403 | `SPARQL Update is not allowed …` | The proxy is read-only. |
| 403 | `SERVICE (federated queries) is not allowed …` | Run federated queries against the endpoints directly. |
| 403 | `Property paths over the hidden property … are not allowed` | Write the path out as separate triple patterns, or drop the hidden property. |
| 400 | `Cannot parse query: …` | Not valid SPARQL 1.1. Vendor extensions (Virtuoso `DEFINE`, …) are not supported. |
| 400 | `Transitive property paths (* and +) are not allowed under row-level policies …` | See below. |
| 400 | `Negated property sets are not allowed when properties are hidden` | List the predicates you want instead of `!(…)`. |
| 400 | `FROM / FROM NAMED are not supported under row-level policies; use GRAPH instead` | The policy uses `sg:readAllGraphs` together with row-level rules. Use `GRAPH <…> { }`, or list the graphs with `sg:readGraph`. |
| 400 | `Variables starting with ?__sg_ are reserved` | Rename the variable. |
| 502 | network error text | The upstream store is unreachable or timed out (`timeoutMs`). |

Any other status, such as a 400 with a store-specific message, comes from the store itself.

## Policy files that do not load

At startup the error is printed and the process exits. On reload, the error is logged and the
previous policies stay active:

```text
Policy reload failed, keeping previous policies: closed on shape <…> is not supported by sparql-guard
```

| Message | Fix |
| --- | --- |
| `Cannot parse policies.ttl: …` | Turtle syntax error; the message has the line number. |
| `… is not supported by sparql-guard` | The shape uses a SHACL feature outside the [supported subset](../reference/policy-language#supported-shacl). |
| `Policy … applies to nobody` | Add `sg:agent` or `sg:group`. |
| `Recursive shape reference …` | A shape refers to itself through `sh:node`, `sh:and`, … |
| `sg:hideProperties shape … needs sh:property entries with a plain IRI sh:path` | Only plain predicates can be hidden. |
| `Cardinality … is too large` | `sh:minCount` / `sh:maxCount` above 8. |

## "A user sees too little"

- **Restrictions add up.** If the user is in several groups, every `sg:visibleIf` of every
  matching policy applies. The explain output lists the matched policies.
- **Hidden references.** With `sg:hideReferences` on (the default), a triple whose object is
  hidden disappears, so `?x ex:manager ?m` returns nothing if the manager is hidden. Use
  `OPTIONAL` for links that may point to hidden resources, or set `sg:hideReferences false`.
- **Shape semantics.** `sh:hasValue` requires the value to be present; `sh:in` requires every
  value to be in the list. A resource without the property conforms to `sh:in` but not to
  `sh:hasValue`.
- **Default graph.** With `sg:readAllGraphs`, a query without `GRAPH` sees the store's default
  graph, which may be empty. See [Triple stores](./triple-stores).

## "A user sees too much"

- Check whether a policy with `sg:readAllGraphs` or `sg:agent sg:Anyone` also matches.
- Check that the store respects `FROM`; see [Triple stores](./triple-stores#check-your-store).
- Resources that are not a target of any shape are never hidden. Check that the targets match
  the data: the class IRI, and that the `rdf:type` triple **and** any `rdfs:subClassOf` triples
  are in a graph the policy grants. Checks can't see graphs the caller can't read.

## Slow queries

See [Performance](./how-it-works#performance). In short: fewer and more specific shapes,
`graphSpanningChecks: false` when a resource's data lives in one graph, and graph-only policies
for users who do not need row-level rules.
