# Playground

The repository ships a Docker Compose stack with fictional railway data and six access roles.
Use it to try your own queries and policies without setting up a store.

```sh
git clone https://github.com/Matdata-eu/sparql-guard.git
cd sparql-guard
docker compose up --build
```

| URL | What |
| --- | --- |
| <http://localhost:8095> | Query UI with a role picker |
| <http://localhost:8095/sparql> | The guarded SPARQL endpoint |
| <http://localhost:7879> | The unguarded store, for comparison |

Set `SG_UI_PORT` or `SG_STORE_PORT` if those ports are taken.

## What is in it

| Service | Role |
| --- | --- |
| `store-load` | Loads `examples/railway/data.trig` into an Oxigraph database, then exits. |
| `store` | Oxigraph, serving that database read-only. |
| `guard` | sparql-guard with `examples/railway/policies.ttl`. |
| `ui` | nginx serving a Yasgui page and forwarding `/sparql` to the guard. |

## The data

The data is a small, made-up railway infrastructure manager, spread over six named graphs:

| Graph | Contents |
| --- | --- |
| `…/graph/network` | Lines 25, 36 and 50, stations, sections, railway undertakings |
| `…/graph/assets` | Signals, switches and level crossings with condition, region and cabinet access codes |
| `…/graph/maintenance` | Work orders with status, assignee and cost |
| `…/graph/timetable` | Train paths of ACME Rail (passenger) and BelCargo (freight) |
| `…/graph/incidents` | Safety incidents, with the driver involved and their statement |
| `…/graph/staff` | Staff records with team, e-mail and salary scale |

All IRIs start with `https://example.org/rail/`; the vocabulary uses the prefix
`rv: <https://example.org/rail/vocab#>`.

## The roles

| Role | Credentials | Sees |
| --- | --- | --- |
| Anonymous | none | the network graph |
| ACME Rail dispatcher | `Authorization: Bearer acme-key` | network and timetable, but only ACME's own train paths |
| Jan, maintenance north | `Authorization: Bearer jan-key` | assets, work orders and staff of the north region, plus his own staff record; no salary scales |
| Els, maintenance south | `Authorization: Bearer els-key` | the same, for the south region |
| Safety analyst | `Authorization: Bearer safety-key` | incidents, assets and timetable; no driver identities or statements, no cabinet access codes |
| Administrator | `Authorization: Bearer admin-key` | everything |
| Custom | `x-forwarded-user`, `x-forwarded-groups` | whatever the policies give that user and groups |

The Custom role uses the trusted-header mode, so you can try any combination of user and
groups, for example Els (`els`) as a member of `maintenance-north`. She then sees the north
team plus her own staff record.

::: danger Demo setting
The playground trusts `x-forwarded-user` from any client so the UI can impersonate users.
Never expose a configuration like that. See [Authentication](./authentication).
:::

## Things to try

The example buttons in the UI run these queries. Switch roles between runs and compare.

**The same aggregate, different answers.** "Total maintenance budget" sums `rv:costEstimateEur`
over all visible work orders: 4,250 for Jan, 61,900 for Els, 66,150 for the administrator.
Hidden work orders never enter the sum.

```sparql
PREFIX rv: <https://example.org/rail/vocab#>
SELECT (SUM(?cost) AS ?total) (COUNT(?order) AS ?orders) WHERE {
  ?order a rv:WorkOrder ; rv:costEstimateEur ?cost .
}
```

**Hidden properties.** As the safety analyst, run "Incidents": the incidents are listed, but
`?driver` and `?statement` stay empty. As the administrator they are filled in.

**Hidden resources in paths.** As Jan, `rd:wo-2026-0412 rv:assignedTo/rdfs:label ?name`
returns "Jan Peeters". The south-region order `rd:wo-2026-0425` returns nothing at all, not
even its label.

**SPARQL 1.2 annotations.** The playground runs with `"sparqlVersion": "1.2"`, and some
incident statements carry RDF 1.2 annotations. "Who confirmed what (SPARQL 1.2)" lists the
annotated statements for the administrator. For the safety analyst it returns nothing,
because those statements are about the hidden driver. See [SPARQL 1.2](./sparql-1-2).

**DESCRIBE.** "DESCRIBE a level crossing" returns the crossing without its access code for the
safety analyst, and nothing for Els, since it is in the north region.

**Refused queries.** "Refused: federated query" uses `SERVICE` and is rejected with a 403.

**What the store receives.** "Show rewritten query" calls the [explain endpoint](../reference/http-api#explain)
and shows the query the store actually receives, including the injected `FILTER`s.

## Changing the policies

Edit `examples/railway/policies.ttl` while the stack runs. The guard notices the change
within a few seconds (`watchPolicies`) and logs:

```text
guard-1  | Reloaded 6 policies
```

If the file does not parse or uses SHACL that sparql-guard can't translate, the error is
logged and the previous policies stay active:

```sh
docker compose logs -f guard
```

To change the data, edit `examples/railway/data.trig` and recreate the database:

```sh
docker compose down -v
docker compose up
```

::: warning Oxigraph and the union default graph
The store runs **without** `--union-default-graph`. With that flag, Oxigraph ignores `FROM`
clauses and answers from every graph, which would switch off graph-level policies. See
[Triple stores](./triple-stores).
:::
