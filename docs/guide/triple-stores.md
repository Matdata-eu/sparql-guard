# Triple stores

sparql-guard sends standard SPARQL 1.1 queries, so it works with any store that implements the
query language and the protocol. Graph-level policies depend on one feature in particular:
**dataset clauses** (`FROM` and `FROM NAMED`). The store must answer from exactly the graphs
listed there.

## Check your store

Before relying on graph-level policies, check that your store respects `FROM`. Pick two
graphs, `A` and `B`, that both contain data, and ask the store directly:

```sparql
SELECT (COUNT(*) AS ?n) FROM <A> WHERE { ?s ?p ?o }
```

```sparql
SELECT (COUNT(*) AS ?n) WHERE { GRAPH <A> { ?s ?p ?o } }
```

Both counts must be equal, and the first must not include triples from `B`. Then check that
`FROM NAMED` limits `GRAPH ?g`:

```sparql
SELECT DISTINCT ?g FROM NAMED <A> WHERE { GRAPH ?g { ?s ?p ?o } }
```

This must return only `A`.

## Store notes

The playground's Oxigraph setup is covered by the test suite. For the other stores, the notes
below are what to look at; run the checks above against your own configuration.

### Oxigraph

- Respects `FROM` / `FROM NAMED` in its default configuration.
- **Do not** start it with `--union-default-graph`: that option makes it ignore `FROM` and
  answer from all graphs, which switches graph-level policies off.

### Apache Jena Fuseki

- Supports dataset clauses for TDB2 datasets.
- `tdb2:unionDefaultGraph true` changes what a query **without** `FROM` sees. That only matters
  for policies with `sg:readAllGraphs`; with `sg:readGraph`, sparql-guard always sends `FROM`.
- The store's real default graph can be granted as `<urn:x-arq:DefaultGraph>`.

### GraphDB

- Supports dataset clauses. Without them, the default graph is the union of all graphs.
- Pseudo-graphs such as `<http://www.ontotext.com/explicit>` and
  `<http://www.ontotext.com/implicit>` are graph IRIs like any other; grant them explicitly if
  needed.
- Full-text search and other "magic" predicates (`luc:`, `con:`) are triple patterns to
  sparql-guard, so they get checks like any pattern. If performance suffers, give that use
  case its own policy without row-level rules.

### Virtuoso

- Supports dataset clauses. Without them, a query sees all graphs.
- Virtuoso-only syntax (`DEFINE` pragmas, `OPTION (…)`, SPARQL-BI extensions) is not
  standard SPARQL and is refused by the parser. Functions such as `bif:contains` are ordinary
  IRIs and are passed through.
- If you use Virtuoso's own graph-level security as well, give the account sparql-guard uses
  read access to all graphs that policies grant.

### Stardog

- Supports dataset clauses. The database option `query.all.graphs` controls what a query
  without `FROM` sees, which only matters for `sg:readAllGraphs`.
- `tag:stardog:api:context:default` and similar special graph IRIs can be granted by IRI.

### QLever

- Check the dataset-clause behaviour of your version with the queries above. QLever's support
  for named graphs is more recent than in the other stores.

## Read-only endpoints

sparql-guard never sends updates. Still, point it at a **query-only** endpoint (for example
Fuseki's `/sparql` or `/query`, not `/update`) and use store credentials that cannot write.
That is a second line of defence in case of a bug.
