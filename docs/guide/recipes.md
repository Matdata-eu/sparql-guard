# Policy recipes

Complete, copy-ready policies for common situations. Each block loads on its own. The
documentation's test suite loads every one of them, so they stay valid.

## Public subset of a graph

Only resources flagged as published are visible to the public; everything else in the graph
stays internal.

```turtle
@prefix sg:  <https://matdata.eu/ns/sparql-guard#> .
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix ex:  <https://example.org/> .

ex:public a sg:Policy ;
  sg:agent sg:Anyone ;
  sg:readGraph <https://example.org/graph/catalogue> ;
  sg:visibleIf ex:PublishedOnly .

ex:PublishedOnly a sh:NodeShape ;
  sh:targetClass ex:Dataset ;
  sh:property [ sh:path ex:published ; sh:hasValue true ] .
```

## Owner-only records

Each user sees only the records they own. Requires agent IRIs that match the values of
`ex:owner`.

```turtle
@prefix sg: <https://matdata.eu/ns/sparql-guard#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix ex: <https://example.org/> .

ex:self-service a sg:Policy ;
  sg:agent sg:AuthenticatedAgent ;
  sg:readGraph <https://example.org/graph/requests> ;
  sg:visibleIf ex:OwnRequestsOnly .

ex:OwnRequestsOnly a sh:NodeShape ;
  sh:targetClass ex:Request ;
  sh:property [ sh:path ex:owner ; sh:hasValue sg:requestingAgent ] .
```

## Tenants in a shared graph

Several organisations' data in one graph, with a group per tenant.

```turtle
@prefix sg: <https://matdata.eu/ns/sparql-guard#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix ex: <https://example.org/> .

ex:tenant-acme a sg:Policy ;
  sg:group "tenant-acme" ;
  sg:readGraph <https://example.org/graph/shared> ;
  sg:visibleIf ex:AcmeOnly .

ex:AcmeOnly a sh:NodeShape ;
  sh:targetSubjectsOf ex:tenant ;
  sh:property [ sh:path ex:tenant ; sh:hasValue ex:acme ] .
```

`sh:targetSubjectsOf ex:tenant` targets everything that carries a tenant, whatever its class.
If every tenant has its own graphs, a plain `sg:readGraph` per tenant is simpler and faster.

## Personal data

Keep people visible but drop personal details, for everyone but HR.

```turtle
@prefix sg:   <https://matdata.eu/ns/sparql-guard#> .
@prefix sh:   <http://www.w3.org/ns/shacl#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix ex:   <https://example.org/> .

ex:employees a sg:Policy ;
  sg:agent sg:AuthenticatedAgent ;
  sg:readGraph <https://example.org/graph/people> ;
  sg:hideProperties ex:NoPersonalData .

ex:NoPersonalData a sh:NodeShape ;
  sh:targetClass foaf:Person ;
  sh:property [ sh:path foaf:birthday ], [ sh:path foaf:phone ], [ sh:path ex:homeAddress ] .

ex:hr a sg:Policy ;
  sg:group "hr" ;
  sg:readGraph <https://example.org/graph/people> .
```

::: warning Restrictions add up
An HR member who is also authenticated matches **both** policies, and the hidden properties
from `ex:employees` apply to them too. To exempt HR, scope the restricted policy to a group
that HR members are not in (for example `sg:group "staff"`) rather than to
`sg:AuthenticatedAgent`.
:::

## Embargo until a date

Reports are visible once their release date has passed. SPARQL has no fixed "now" in shapes,
so the date is part of the policy; update it from a scheduled job, and the proxy reloads it.

```turtle
@prefix sg:  <https://matdata.eu/ns/sparql-guard#> .
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix ex:  <https://example.org/> .

ex:press a sg:Policy ;
  sg:group "press" ;
  sg:readGraph <https://example.org/graph/reports> ;
  sg:visibleIf ex:Released .

ex:Released a sh:NodeShape ;
  sh:targetClass ex:Report ;
  sh:property [
    sh:path ex:releaseDate ;
    sh:minCount 1 ;
    sh:maxInclusive "2026-10-10"^^xsd:date ;
  ] .
```

## Hide specific resources

Block a list of resources outright. `sh:in ()` (an empty list) can never be satisfied, so every
target is hidden.

```turtle
@prefix sg: <https://matdata.eu/ns/sparql-guard#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix ex: <https://example.org/> .

ex:partners a sg:Policy ;
  sg:group "partners" ;
  sg:readGraph <https://example.org/graph/projects> ;
  sg:visibleIf ex:NotTheseProjects .

ex:NotTheseProjects a sh:NodeShape ;
  sh:targetNode ex:project-titan, ex:project-orion ;
  sh:in ( ) .
```

Use `sh:targetClass ex:Draft ; sh:in ( )` the same way to hide every instance of a class.

## Licence-based access

Datasets are visible when their licence is one the caller's group may use.

```turtle
@prefix sg:  <https://matdata.eu/ns/sparql-guard#> .
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix ex:  <https://example.org/> .

ex:open-data a sg:Policy ;
  sg:agent sg:Anyone ;
  sg:readGraph <https://example.org/graph/catalogue> ;
  sg:visibleIf ex:OpenLicences .

ex:OpenLicences a sh:NodeShape ;
  sh:targetClass ex:Dataset ;
  sh:property [
    sh:path dct:license ;
    sh:minCount 1 ;
    sh:in (
      <http://creativecommons.org/licenses/by/4.0/>
      <http://creativecommons.org/publicdomain/zero/1.0/>
    ) ;
  ] .
```

## Region of the user's team

Users see assets in the region of their own team. The region is looked up from the data
through the requesting agent, so no group per region is needed.

```turtle
@prefix sg: <https://matdata.eu/ns/sparql-guard#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix ex: <https://example.org/> .

ex:field-staff a sg:Policy ;
  sg:group "field-staff" ;
  sg:readGraph <https://example.org/graph/assets>, <https://example.org/graph/staff> ;
  sg:visibleIf ex:AssetsInMyRegion .

ex:AssetsInMyRegion a sh:NodeShape ;
  sh:targetClass ex:Asset ;
  sh:property [
    sh:path ( ex:region [ sh:inversePath ex:team ] ex:account ) ;
    sh:hasValue sg:requestingAgent ;
  ] .
```

The path reads: the asset's region, then the staff whose team is that region, then their
account. The asset is visible when the requesting agent is one of those accounts.
