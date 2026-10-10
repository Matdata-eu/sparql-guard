---
layout: home

hero:
  name: sparql-guard
  text: Access control for any SPARQL endpoint
  tagline: Graph-level and row-level policies written in SHACL, enforced by rewriting queries in a proxy in front of your triple store.
  image:
    src: /shield.svg
    alt: sparql-guard
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Try the playground
      link: /guide/playground
    - theme: alt
      text: How it works
      link: /guide/how-it-works

features:
  - title: Store-neutral
    details: Works in front of any SPARQL 1.1 endpoint, whether that is Fuseki, GraphDB, Virtuoso, Stardog, Oxigraph or QLever. One policy model instead of one per vendor.
  - title: Policies in SHACL
    details: "Row-level rules are ordinary SHACL shapes: \"an employee is visible if it belongs to Sales\", \"documents are visible to their owner\". No new rule language to learn."
  - title: Rewrites, not post-filters
    details: Aggregates, FILTER EXISTS, MINUS, OPTIONAL and sub-queries all run over the restricted view, so counts and joins cannot leak hidden data.
  - title: Fails closed
    details: SHACL it cannot translate stops the policy from loading. Queries it cannot rewrite safely, such as SERVICE or updates, are refused rather than passed through.
  - title: Built on Traqula
    details: Queries are parsed into SPARQL algebra, rewritten and generated back with Comunica's Traqula, not with regular expressions.
  - title: Ready to deploy
    details: A small Node.js service with a container image, API keys or identity from your auth proxy, live policy reload and an explain endpoint.
---
