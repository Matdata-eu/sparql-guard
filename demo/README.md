# sparql-guard demo

The stack behind the [online demo](https://matdata-eu.github.io/sparql-guard/demo/): the railway
example data in Oxigraph, behind sparql-guard, with a static page to pick a user and run queries.

```sh
docker compose up -d --build
```

- <http://localhost:8096/sparql>: the guarded endpoint
- <http://localhost:8097>: the demo page, pointing at the local endpoint

The demo users' API keys (`acme-key`, `jan-key`, `els-key`, `safety-key`, `admin-key`) are
public on purpose. See the [demo documentation](https://matdata-eu.github.io/sparql-guard/guide/demo)
for hosting the endpoint behind a reverse proxy.
