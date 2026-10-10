# SPARQL 1.2 and triple terms

RDF 1.2 adds **triple terms**: a triple used as a value, typically the object of an
`rdf:reifies` statement. SPARQL 1.2 adds syntax for them:

```sparql
PREFIX ex: <https://example.org/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

SELECT * WHERE {
  ex:alice ex:name ?name {| ex:source ?src |} .        # annotation
  << ex:alice ex:salary ?s >> ex:approvedBy ?who .      # reifier
  ?r rdf:reifies ?t .                                   # triple term in a variable
  FILTER(isTRIPLE(?t) && SUBJECT(?t) = ex:alice)        # triple term functions
}
```

Turn it on in the [configuration](../reference/configuration):

```json
{ "sparqlVersion": "1.2" }
```

or for the CLI with `sparql-guard rewrite --sparql 1.2 …`.

## Why it matters for access control

A triple term carries a complete triple. Take this data:

```turtle
ex:alice ex:salary 5000 ~ ex:r1 {| ex:source ex:payroll |} .
```

It holds the asserted triple `ex:alice ex:salary 5000`, and the reifier triple
`ex:r1 rdf:reifies <<( ex:alice ex:salary 5000 )>>`. If salaries are hidden, filtering the
asserted triple is not enough: `SELECT ?t WHERE { ?r rdf:reifies ?t }` would return the
salary inside the triple term.

With `"sparqlVersion": "1.2"`, sparql-guard treats a triple term as visible only when the
triple it contains would be visible itself:

| In the query | Check |
| --- | --- |
| A triple term pattern, `<<( ?s ex:salary ?x )>>` | Its subject, predicate and object are checked like any triple pattern. |
| A variable that may be bound to a triple term, e.g. `?t` in `?r rdf:reifies ?t` | At run time: `!isTRIPLE(?t)`, or the triple unpacked with `SUBJECT`, `PREDICATE` and `OBJECT` is visible. |
| A triple term nested inside another triple term | Hidden, not unpacked further. |

The checks work for the reifier and annotation syntax too, because Traqula translates those
into `rdf:reifies` patterns with triple terms.

::: warning Use 1.2 whenever the data has triple terms
In `1.1` mode, queries are parsed as SPARQL 1.1 and triple terms are **not** checked. A plain
`?s ?p ?o` can then return triple terms that contain hidden triples. If your store holds
RDF 1.2 or RDF-star data, set `"sparqlVersion": "1.2"`, even if your users only write
SPARQL 1.1. SPARQL 1.2 is a superset, so their queries keep working.
:::

## Reifiers are resources

A reifier such as `ex:r1` is a resource in its own right. Its other triples
(`ex:r1 ex:source ex:payroll`) stay visible when the reified triple is hidden; only the
`rdf:reifies` link to the hidden triple disappears. That shows that *some* statement has a
source, but not what the statement is. If reifiers themselves must disappear, target them with
a shape, for example `sh:targetSubjectsOf ex:source`.

## Store requirements

In 1.2 mode, row-level policies add `isTRIPLE`, `SUBJECT`, `PREDICATE` and `OBJECT` to the
rewritten queries. The store must support those functions; stores that implement SPARQL 1.2
or the earlier RDF-star / SPARQL-star drafts generally do. Graph-only policies add none of them,
so 1.2 mode costs nothing there.

The [playground](./playground) runs in 1.2 mode, and its incident data has annotations: as
the safety analyst, "Who confirmed what (SPARQL 1.2)" returns nothing, because the annotated
statements are about the hidden `rv:involvedDriver`. As the administrator it lists both.
