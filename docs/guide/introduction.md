# What is sparql-guard?

sparql-guard is an access-control proxy for SPARQL endpoints. It sits between your users and
your triple store, decides what each caller is allowed to see, and rewrites every query so it
can only see that.

```text
                 ┌──────────────── sparql-guard ────────────────┐
client ──query──►│ authenticate → resolve policies → rewrite    │──rewritten query──► triple store
       ◄─result──│                                              │◄─────result──────── (any SPARQL 1.1)
                 └──────────────────────────────────────────────┘
```

## The problem

Fine-grained access control for RDF data exists, but only *inside* individual products:
Virtuoso has graph ACLs, GraphDB and Stardog have their own security models, and research
papers describe many more. Each one has its own configuration, and none of them carries over
when you change stores or run several of them side by side.

Most RDF publishing setups therefore end up with one of these:

- a separate store, or a separate copy of the data, per audience;
- an application layer with hand-written queries in place of an open SPARQL endpoint;
- no fine-grained access control at all.

## The approach

sparql-guard keeps the SPARQL endpoint open and moves access control into a proxy that works
with any standard store:

- **Who** is asking comes from an API key, from headers set by your authentication proxy, or
  the request is anonymous.
- **What** they may see is described in policies written in RDF. A policy grants named graphs
  and can restrict them further with **SHACL shapes**. If a resource is a target of the shape
  but does not conform to it, the caller cannot see it.
- **How** it is enforced: the query is parsed into SPARQL algebra and every graph pattern gets a
  filter that implements the policy. The result is a normal SPARQL 1.1 query that the store
  executes as usual.

The rewritten query answers the original question over a *view* of the data that contains
only what the caller may see. Because the view is applied to every pattern, also inside
`FILTER EXISTS`, `OPTIONAL`, `MINUS`, sub-queries and aggregates, a `COUNT` or an existence
test can't reveal what is hidden either.

## When to use it

sparql-guard fits well when:

- you publish a SPARQL endpoint to several audiences (public, partners, internal teams) from
  one store;
- the access rules depend on the data itself ("only work orders in my region", "only
  documents I own");
- you want the same access model regardless of the store you run;
- you already describe your data with SHACL.

It is not a replacement for:

- **write access control**: sparql-guard only reads and always refuses SPARQL Update;
- **network security**: clients must not be able to reach the store directly;
- **protection against side channels**: run time can still depend on hidden data. See the
  [security model](./security-model).

## Next steps

- [Getting started](./getting-started): run it against your own store.
- [Playground](./playground): a ready-made Docker Compose setup with railway data and roles.
- [How it works](./how-it-works): what a rewritten query looks like.
