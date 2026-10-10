# Writing policies

This guide builds a policy set step by step. The complete vocabulary is in the
[policy language reference](../reference/policy-language).

Policies are RDF. Keep them in one or more Turtle (`.ttl`) or TriG (`.trig`) files and list
them under `policies` in the [configuration](../reference/configuration).

```turtle
@prefix sg:  <https://matdata.eu/ns/sparql-guard#> .
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix ex:  <https://example.org/> .
@prefix pol: <https://example.org/policy/> .
```

## 1. Decide who a policy is for

A policy applies to the agents and groups it names:

```turtle
pol:everyone a sg:Policy ;
  sg:agent sg:Anyone ;                         # also anonymous requests
  sg:readGraph <https://example.org/graph/public> .

pol:staff a sg:Policy ;
  sg:agent sg:AuthenticatedAgent ;             # anyone who logged in
  sg:readGraph <https://example.org/graph/intranet> .

pol:alice a sg:Policy ;
  sg:agent <https://example.org/people/alice> ; # one agent
  sg:readGraph <https://example.org/graph/projects> .

pol:finance a sg:Policy ;
  sg:group "finance" ;                         # members of a group
  sg:readGraph <https://example.org/graph/ledger> .
```

Agent IRIs and group names come from [authentication](./authentication). A request that
matches no policy at all is refused with `403`.

## 2. Grant graphs

`sg:readGraph` grants one named graph; repeat it for more. `sg:readAllGraphs true` grants
everything and leaves the dataset to the store.

For a policy with `sg:readGraph`, a query without `FROM` sees the **union of the granted
graphs** as its default graph. Users do not need to know which graphs exist, and a query that
works for one role works unchanged for another.

::: tip Prefer listing graphs
With `sg:readAllGraphs`, the store's own default-graph behaviour applies: some stores give the
union of all graphs, others a separate default graph. Listing the graphs gives the same
behaviour on every store.
:::

## 3. Hide resources with sg:visibleIf

A `sg:visibleIf` shape hides the resources that are a target of the shape but do not conform
to it:

```turtle
pol:sales a sg:Policy ;
  sg:group "sales" ;
  sg:readGraph <https://example.org/graph/crm> ;
  sg:visibleIf pol:OpenDealsOnly .

pol:OpenDealsOnly a sh:NodeShape ;
  sh:targetClass ex:Deal ;
  sh:property [
    sh:path ex:status ;
    sh:in ( "open" "negotiating" ) ;
  ] .
```

Read it as: *a deal is visible if all its statuses are "open" or "negotiating"*. Closed deals
disappear: their triples, and the triples that point to them.

Some things to keep in mind:

- **Targets decide what is affected.** Resources that are not targets of a shape are never
  hidden by it. Here, customers and products stay visible.
- **Conformance follows SHACL.** `sh:in` means *every* value is in the list, so a deal without
  a status conforms. Add `sh:minCount 1` to require one.
- **Subclasses count.** `sh:targetClass ex:Deal` also targets instances of subclasses of
  `ex:Deal`, as in SHACL.
- **Checks only see readable graphs.** Whether a resource is a target, and whether it
  conforms, is evaluated against the graphs the policy grants. If the `rdf:type` triples, the
  `rdfs:subClassOf` hierarchy or the values a shape tests live in a graph the caller can't
  read, the shape doesn't match those resources and **does not hide them**. Grant the graph
  that holds your schema, or keep the type and the tested properties next to the data.
- **Several shapes all apply.** A resource must pass every `sg:visibleIf` shape it is a target
  of.

## 4. Hide properties with sg:hideProperties

To keep a resource visible but drop some of its properties, use `sg:hideProperties`:

```turtle
pol:sales sg:hideProperties pol:NoMargins .

pol:NoMargins a sh:NodeShape ;
  sh:targetClass ex:Deal ;
  sh:property [ sh:path ex:margin ], [ sh:path ex:internalNote ] .
```

Without a target, the properties are hidden on every subject. The paths must be plain
predicates.

## 5. Make rules depend on who is asking

`sg:requestingAgent` stands for the agent IRI of the current request. Use it as a value in a
shape:

```turtle
pol:sales sg:visibleIf pol:OwnDealsOnly .

pol:OwnDealsOnly a sh:NodeShape ;
  sh:targetClass ex:Deal ;
  sh:property [ sh:path ex:accountManager ; sh:hasValue sg:requestingAgent ] .
```

For this to work, the agent IRIs from authentication must be the IRIs used in the data. With
trusted headers, `agentPrefix` turns a user name into an IRI; for API keys, set `agent` to the
IRI used in the data.

## 6. Combine with logic

`sh:or`, `sh:and`, `sh:not` and `sh:xone` combine conditions. A manager sees the deals of their
team, or deals they manage themselves:

```turtle
pol:TeamOrOwnDeals a sh:NodeShape ;
  sh:targetClass ex:Deal ;
  sh:or (
    [ sh:property [ sh:path ( ex:accountManager ex:team ) ; sh:hasValue ex:team-benelux ] ]
    [ sh:property [ sh:path ex:accountManager ; sh:hasValue sg:requestingAgent ] ]
  ) .
```

`( ex:accountManager ex:team )` is a SHACL sequence path: the team of the account manager.

## 7. Check and test

```sh
# Do the policies load? Lists each policy with its number of rules.
sparql-guard check --policies policies.ttl

# What does a query become for this agent?
sparql-guard rewrite --policies policies.ttl \
  --agent https://example.org/people/alice --group sales query.rq
```

When the proxy runs with `"explain": true`, `POST /sparql/explain` returns the rewritten
query for the caller's own credentials.

Policies that use SHACL sparql-guard cannot translate **do not load**. The proxy then refuses
to start, or keeps the previous version when reloading. That is deliberate: a policy that
silently ignored a constraint would show more than intended.

## How policies combine

When several policies apply to one request:

| Aspect | Combination |
| --- | --- |
| Graphs | Union of all granted graphs. `sg:readAllGraphs` in any of them wins. |
| `sg:visibleIf`, `sg:hideProperties` | **All** of them apply, also those from policies that grant other graphs. |
| `sg:hideReferences` | On if any restricting policy leaves it on. |
| `sg:allowTransitivePaths` | Only if every restricting policy allows it. |

Restrictions add up, so give unrestricted roles (administrators, auditors) a group that is not
also a member of a restricted group, or the restrictions will apply to them as well.

Continue with ready-made patterns in [Policy recipes](./recipes).
