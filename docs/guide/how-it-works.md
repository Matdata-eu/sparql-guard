# How it works

Every request goes through the same five steps.

```text
1 authenticate ─► 2 resolve policies ─► 3 parse to algebra ─► 4 rewrite ─► 5 generate & forward
```

1. **Authenticate.** The caller becomes an *agent* (an IRI) with a set of *groups*, or is
   anonymous. See [Authentication](./authentication).
2. **Resolve policies.** Every `sg:Policy` whose `sg:agent` or `sg:group` matches is merged into
   one *effective policy*: the granted graphs add up, and so do the restrictions.
3. **Parse.** [Traqula](https://github.com/comunica/traqula) parses the query and translates it
   into SPARQL algebra, the tree of operations (`bgp`, `join`, `leftjoin`, `filter`, `graph`,
   `project`, …) that the SPARQL specification defines the language in.
4. **Rewrite.** sparql-guard transforms that tree (see below).
5. **Generate and forward.** Traqula turns the tree back into a SPARQL string, which is sent to
   the store with a normal SPARQL 1.1 Protocol request. The store's response is streamed back
   unchanged.

## The view

The rewritten query is the original query evaluated over a **view** of the store. The view
contains:

- only the named graphs that the policies grant;
- of those, only the triples
  - whose **subject** is visible,
  - whose **object** is visible (unless `sg:hideReferences false`), and
  - whose **predicate** is not hidden for that subject.

A resource is **visible** unless it is a target of a `sg:visibleIf` shape and does not conform
to it. Visibility is decided against all readable data, not against the view, so a resource is
still recognised as a target when its `rdf:type` triple is in a different graph than the
triple being checked.

## Step by step

Take this policy:

```turtle
@prefix sg: <https://matdata.eu/ns/sparql-guard#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix ex: <https://example.org/> .

ex:sales a sg:Policy ;
  sg:group "sales" ;
  sg:readGraph <https://example.org/graph/hr> ;
  sg:visibleIf ex:SalesOnly .

ex:SalesOnly a sh:NodeShape ;
  sh:targetClass ex:Employee ;
  sh:property [ sh:path ex:department ; sh:hasValue ex:Sales ] .
```

### Compiling the shape

When the policies are loaded, each shape is compiled into a SPARQL expression over a
placeholder focus node `?this`. "Hidden" means *is a target* and *does not conform*, so
"visible" is:

```sparql
NOT EXISTS {
  ?this rdf:type/rdfs:subClassOf* ex:Employee .             # target (incl. subclasses)
  FILTER(!(EXISTS { ?this ex:department ex:Sales . }))      # does not conform
}
```

The expression is parsed into algebra once and kept as a template.

### Dataset

A member of `sales` sends:

```sparql
PREFIX ex: <https://example.org/>
SELECT ?name WHERE { ?e ex:name ?name }
```

The query names no graphs, so the default graph becomes the union of the granted graphs, and
the named graphs are exactly the granted ones:

```sparql
SELECT ?name
FROM <https://example.org/graph/hr>
FROM NAMED <https://example.org/graph/hr>
WHERE { … }
```

If the query has its own `FROM` / `FROM NAMED`, or the request has `default-graph-uri` /
`named-graph-uri` parameters, they are intersected with the granted graphs, following the
dataset rules of SPARQL 1.1. A graph that is not granted is silently left out, as if it were
empty. An empty result never reveals whether a graph exists.

### Filtering the patterns

Every basic graph pattern gets a `FILTER` that instantiates the template for each subject and
object in it. Simplified, the query becomes:

```sparql
SELECT ?name FROM … WHERE {
  ?e ex:name ?name .
  FILTER(
    NOT EXISTS { ?e rdf:type/rdfs:subClassOf* ex:Employee .
                 FILTER(!(EXISTS { ?e ex:department ex:Sales . })) }
    && ( isLiteral(?name) ||
         NOT EXISTS { ?name rdf:type/rdfs:subClassOf* ex:Employee .
                      FILTER(!(EXISTS { ?name ex:department ex:Sales . })) } )
  )
}
```

Objects are checked too, because `sg:hideReferences` is on by default. The `isLiteral` test
lets the store skip the check when the object is a literal, which can never be a hidden
resource.

This happens to **every** pattern in the algebra tree, wherever it is: inside `OPTIONAL`,
`MINUS`, `UNION`, sub-queries, `GRAPH` blocks and the graph patterns of `FILTER EXISTS`. A user
cannot hide a pattern from the rewrite by nesting it.

::: details What the store really receives
The real query is longer. With [`graphSpanningChecks`](../reference/configuration) on (the
default), every triple in a check is looked up in the active graph *and* in every named graph,
as `{ t } UNION { GRAPH ?g { t } }`. Otherwise a user could query graph A to avoid a check
that needs the `rdf:type` triple stored in graph B. Injected variables are named `?__sg_…`,
and user queries may not use that prefix.

Use `sparql-guard rewrite` or the [explain endpoint](../reference/http-api#explain) to see the
exact query for any agent.
:::

### Hidden properties

A `sg:hideProperties` shape adds conditions on the predicate:

| Pattern | Added condition |
| --- | --- |
| `?s ex:salary ?o`, salary hidden for all subjects | the pattern can never match |
| `?s ex:salary ?o`, salary hidden for targets | `?s` is not a target |
| `?s ?p ?o` | `?p NOT IN (ex:salary)`, or `?s` is not a target |

### Forms that would leak

Some constructs cannot be filtered pattern by pattern. They are rewritten or refused:

| Construct | Treatment |
| --- | --- |
| `DESCRIBE` | Rewritten to `CONSTRUCT { ?r ?p ?o } WHERE { … ?r ?p ?o }`, which is filtered like everything else. A store's own `DESCRIBE` would return everything it knows about the resource. |
| Property paths | Both ends are checked. Sequences (`a/b`) are expanded into separate triple patterns, so their intermediate nodes are checked as well. |
| `*` and `+` paths | Refused under `sg:visibleIf` rules, since their intermediate nodes can't be checked. Opt in with `sg:allowTransitivePaths`. |
| Paths over a hidden property, negated property sets | Refused when properties are hidden. |
| `SERVICE` | Refused: the remote endpoint is outside the policy. |
| SPARQL Update | Refused: the proxy is read-only. |

## Performance

Each visibility rule adds a `NOT EXISTS` per distinct subject and object in a basic graph
pattern. Most stores evaluate these as anti-joins and handle them well, but costs grow with:

- the number of `sg:visibleIf` shapes that apply to the agent;
- `sh:targetClass` with deep class hierarchies (the `rdfs:subClassOf*` closure);
- `graphSpanningChecks` with many named graphs.

Ways to keep queries fast:

- Prefer `sh:targetClass` on specific classes over shapes without targets.
- If all triples about a resource live in one graph, set `graphSpanningChecks: false`.
- Give users who do not need row-level rules a policy without them: graph-only policies add
  no filters at all.
