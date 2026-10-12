# Live demo

**[Open the demo](https://matdata-eu.github.io/sparql-guard/demo/)**

The demo page shows the access policies, the complete data and a query editor. Pick one of six
users, run a query, and the page sends it to a live sparql-guard endpoint at
`https://sparql-guard.matdata.eu/sparql` with that user's credentials. You see:

- the **result** as that user gets it;
- the **rewritten query** that sparql-guard sent to the triple store for them;
- with **Compare all users**, the same query run for every user side by side.

The data and roles are the railway example also used by the [playground](./playground): a
fictional infrastructure manager with lines, track assets, maintenance work orders, a
timetable, incidents and staff, plus RDF 1.2 annotations on some incident statements.

| User | Credentials | Sees |
| --- | --- | --- |
| Visitor | none | the public network |
| ACME Rail dispatcher | `Bearer acme-key` | network and timetable, only ACME's own trains |
| Jan, maintenance north | `Bearer jan-key` | assets, work orders and staff of the north region, plus his own record; no salary scales |
| Els, maintenance south | `Bearer els-key` | the same, for the south region |
| Safety analyst | `Bearer safety-key` | incidents, assets and timetable; no driver identities or statements, no cabinet codes |
| Administrator | `Bearer admin-key` | everything |

The API keys are public on purpose: the point of the demo is that anybody can try every role.
You can use them from any SPARQL client too:

```sh
curl -H 'Authorization: Bearer jan-key' \
  -H 'Accept: text/csv' \
  --data-urlencode 'query=PREFIX rv: <https://example.org/rail/vocab#>
SELECT (SUM(?c) AS ?total) WHERE { ?o a rv:WorkOrder ; rv:costEstimateEur ?c }' \
  https://sparql-guard.matdata.eu/sparql
```

## Run the demo yourself

The demo stack lives in [`demo/`](https://github.com/Matdata-eu/sparql-guard/tree/main/demo):

```sh
cd demo
docker compose up -d
```

| URL | What |
| --- | --- |
| <http://localhost:8096/sparql> | the guarded endpoint |
| <http://localhost:8097> | the demo page, pointing at the local endpoint |

Change the ports with `SG_DEMO_PORT` and `SG_DEMO_PAGE_PORT`. The page talks to
`http://localhost:8096/sparql` when it is opened from `localhost`, and to
`https://sparql-guard.matdata.eu/sparql` otherwise. Add `?endpoint=<url>` to the page URL, or
edit the field at the top of the page, to point it at another endpoint.

| Service | Role |
| --- | --- |
| `store-load` | Loads `examples/railway/data.trig` into an Oxigraph database, then exits. |
| `store` | Oxigraph, read-only, reachable only inside the compose network. |
| `guard` | sparql-guard with [`demo/sparql-guard.json`](https://github.com/Matdata-eu/sparql-guard/blob/main/demo/sparql-guard.json) and the railway policies. |
| `page` | nginx serving the demo page with the data and policies next to it. |

Compared to the playground, the demo configuration is meant to face the internet: API keys
only (no trusted headers), a 15-second upstream timeout, and no live policy reload.

## Hosting the endpoint

Put the `guard` service behind your reverse proxy with TLS. sparql-guard serves the endpoint on
`/sparql` and answers CORS requests itself, so the proxy only forwards. With Caddy:

```text
sparql-guard.matdata.eu {
  reverse_proxy localhost:8096
}
```

With nginx:

```nginx
server {
  listen 443 ssl;
  server_name sparql-guard.matdata.eu;
  # ssl_certificate …

  location / {
    proxy_pass http://127.0.0.1:8096;
    proxy_set_header Host $host;
    proxy_read_timeout 30s;
    client_max_body_size 1m;
  }
}
```

The `page` service is only for trying the page locally; on the server you can drop it with
`docker compose up -d store-load store guard`.

Things to keep in mind for a public endpoint:

- **Rate limiting.** sparql-guard has none. Add it in the reverse proxy if the endpoint gets
  abused (for example nginx `limit_req`).
- **Updates** are refused by sparql-guard, and the store runs read-only as well.
- **The explain endpoint** is on, because the demo page shows the rewritten query. Turn
  `explain` off for real deployments where the policies themselves are confidential.

## How the page is published

The page source is [`demo/page/index.html`](https://github.com/Matdata-eu/sparql-guard/blob/main/demo/page/index.html),
a single static HTML file. The documentation build (`npm run docs:build`) copies it, together
with the example data and policies, into the site at `/demo/`. The GitHub Pages workflow
publishes it with the rest of the documentation, so the demo page always shows the same data
and policies as the repository.
