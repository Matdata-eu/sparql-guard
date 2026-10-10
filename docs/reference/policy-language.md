# Policy language

This page lists the complete policy vocabulary and the supported SHACL subset. For a
step-by-step introduction, read [Writing policies](../guide/writing-policies); for ready-made
examples, see [Policy recipes](../guide/recipes).

Policies are plain RDF in Turtle or TriG. Namespace:

```turtle
@prefix sg: <https://matdata.eu/ns/sparql-guard#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
```

## sg:Policy

| Property | Value | Meaning |
| --- | --- | --- |
| `sg:agent` | IRI | The policy applies to this agent. Special values: `sg:Anyone` (also anonymous requests) and `sg:AuthenticatedAgent`. |
| `sg:group` | literal | The policy applies to members of this group (from the API key or the groups header). |
| `sg:readGraph` | IRI | A named graph the agent may read. Repeat for several graphs. |
| `sg:readAllGraphs` | `true` | Every graph may be read; the dataset is left to the store. |
| `sg:visibleIf` | shape | Row-level rule: targets of the shape that do not conform to it are hidden. |
| `sg:hideProperties` | shape | Hides the properties listed in the shape's `sh:property` paths on its targets. |
| `sg:hideReferences` | boolean | Also hide triples whose **object** is a hidden resource. Default `true`. |
| `sg:allowTransitivePaths` | boolean | Accept `*` and `+` property paths despite row-level rules (see the security model). Default `false`. |

A policy needs at least one `sg:agent` or `sg:group`. A request that matches no policy gets
`403 Forbidden`.

### Several policies for one agent

All policies that apply to a request are merged:

- **graphs add up**: the agent reads the union of the granted graphs;
- **restrictions add up as well**: every `sg:visibleIf` and `sg:hideProperties` of every matching
  policy is enforced (deny overrides). Give administrators a group that is not combined with
  restricted groups if they should see everything.

### The default graph

With `sg:readGraph`, a query without `FROM` sees the union of the readable graphs as its
default graph, and those graphs as its named graphs. `FROM` / `FROM NAMED` narrow that down
(never widen it). With `sg:readAllGraphs`, the store's own default graph is used, so the
behaviour depends on the store (e.g. union default graph in GraphDB, a separate default graph in
Fuseki unless `unionDefaultGraph` is set).

Store-specific "graphs" can be granted by IRI too, e.g. Fuseki's `urn:x-arq:DefaultGraph`.

## Row-level rules with SHACL

### sg:visibleIf

```turtle
ex:ActiveProjectsOnly a sh:NodeShape ;
  sh:targetClass ex:Project ;
  sh:property [ sh:path ex:status ; sh:in ( "active" "planned" ) ] .
```

Every resource that is a **target** of the shape and does **not conform** is hidden. Resources
that are not targets are unaffected. A shape without a target applies to every resource that
appears in subject (or, with `sg:hideReferences`, object) position, so use that with care.

A hidden resource disappears from the view: triples with it as subject are dropped, and so are
triples with it as object (unless `sg:hideReferences false`). Literals are never hidden by
`sg:visibleIf`; use `sg:hideProperties` for that.

### sg:hideProperties

```turtle
ex:NoPersonalData a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [ sh:path ex:birthDate ], [ sh:path ex:phone ] .
```

Triples with one of the listed predicates are dropped when their subject is a target. Without a
target, the predicates are dropped everywhere. Paths must be plain IRIs here.

### sg:requestingAgent

Use `sg:requestingAgent` as a value anywhere in a shape (`sh:hasValue`, `sh:in`, `sh:targetNode`)
to refer to the agent sending the query:

```turtle
ex:OwnRecordsOnly a sh:NodeShape ;
  sh:targetClass ex:Record ;
  sh:property [ sh:path ex:owner ; sh:hasValue sg:requestingAgent ] .
```

Anonymous requests are matched as `urn:sparql-guard:anonymous`.

### Supported SHACL

| Kind | Supported |
| --- | --- |
| Targets | `sh:targetClass` (incl. `rdfs:subClassOf*`), `sh:targetNode`, `sh:targetSubjectsOf`, `sh:targetObjectsOf` |
| Paths | IRIs, sequence lists, `sh:inversePath`, `sh:alternativePath`, `sh:zeroOrMorePath`, `sh:oneOrMorePath`, `sh:zeroOrOnePath` |
| Value type | `sh:class`, `sh:datatype`, `sh:nodeKind` |
| Cardinality | `sh:minCount`, `sh:maxCount` (up to 8) |
| Value range | `sh:minInclusive`, `sh:maxInclusive`, `sh:minExclusive`, `sh:maxExclusive` |
| String | `sh:minLength`, `sh:maxLength`, `sh:pattern` + `sh:flags`, `sh:languageIn` |
| Property pairs | `sh:equals`, `sh:disjoint` |
| Logical | `sh:not`, `sh:and`, `sh:or`, `sh:xone` |
| Shape-based | `sh:node`, `sh:property` |
| Other | `sh:in`, `sh:hasValue`, `sh:deactivated` |

Descriptive properties (`sh:name`, `sh:message`, `sh:severity`, …) are ignored. Anything else
in the `sh:` namespace (`sh:sparql`, `sh:closed`, `sh:qualifiedValueShape`, `sh:lessThan`,
`sh:uniqueLang`, …) and recursive shapes make the policy file **fail to load**: a policy that
silently ignored part of a shape would show more than intended.

Semantics follow SHACL, with one deliberate choice: comparisons that raise an error (e.g.
`sh:maxInclusive 3` on a string) count as violations, so the resource is hidden.

## Checking policies

```sh
sparql-guard check --policies policies.ttl
sparql-guard rewrite --policies policies.ttl --agent https://example.org/people/alice --group sales query.rq
```
