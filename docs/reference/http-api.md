# HTTP API

## SPARQL endpoint

`GET|POST <path>` (default `/sparql`) implements the query operation of the
[SPARQL 1.1 Protocol](https://www.w3.org/TR/sparql11-protocol/):

| Request | Query from |
| --- | --- |
| `GET /sparql?query=…` | the `query` parameter |
| `POST /sparql` with `Content-Type: application/x-www-form-urlencoded` | the `query` form field |
| `POST /sparql` with `Content-Type: application/sparql-query` | the body |

`default-graph-uri` and `named-graph-uri` parameters (in the URL, or in the form body) are
supported and replace the query's `FROM` / `FROM NAMED`, as the protocol specifies. They are
intersected with the granted graphs like `FROM` clauses.

### Credentials

`Authorization: Bearer <key>`, `X-API-Key: <key>`, or the trusted headers. See
[Authentication](../guide/authentication).

### Response

The store's response is streamed back with its status code and `Content-Type`. The `Accept`
header is passed on. If the client sends none (or `*/*`), sparql-guard asks for
`application/sparql-results+json` for SELECT and ASK, and `text/turtle` for CONSTRUCT and
DESCRIBE.

### Status codes

| Status | Meaning |
| --- | --- |
| 200 | Answered by the store. |
| 400 | The query cannot be parsed or cannot be rewritten safely; also a missing `query`. |
| 401 | Missing or invalid credentials. |
| 403 | No policy applies, or the query uses something that is not allowed (updates, `SERVICE`, hidden paths). |
| 404 | Unknown path. |
| 405 | Method other than `GET`, `POST`, `OPTIONS`. |
| 413 | Request body larger than 1 MiB. |
| 415 | Unsupported `Content-Type` for `POST`. |
| 502 | The store could not be reached or timed out. |
| other | Passed through from the store. |

Error responses from sparql-guard are `text/plain` with a one-line message.

### Updates

Requests with `Content-Type: application/sparql-update`, an `update` parameter, or an update
operation in the query are refused with `403` before anything is sent to the store.

### CORS

Responses allow the requesting origin, with the `Authorization`, `Content-Type`, `Accept` and
`X-API-Key` headers, so browser-based clients such as Yasgui can call the endpoint directly.
`OPTIONS` preflight requests are answered with `204`.

## Explain

`GET|POST <path>/explain` takes exactly the same requests as the SPARQL endpoint, but returns
the rewritten query instead of executing it. It is only available with `"explain": true`.

```sh
curl -H 'Authorization: Bearer jan-key' \
  --data-urlencode 'query=SELECT * WHERE { ?s a <https://example.org/rail/vocab#WorkOrder> }' \
  http://localhost:8095/sparql/explain
```

```json
{
  "agent": "urn:sparql-guard:user:jan",
  "groups": ["maintenance-north"],
  "policies": [
    "<https://example.org/rail/policy/public>",
    "<https://example.org/rail/policy/maintenance-north>"
  ],
  "query": "SELECT ?s FROM <https://example.org/rail/graph/network> … WHERE { … }",
  "form": "select"
}
```

Explain applies the same authentication and policies, and returns the same errors, as the
endpoint itself.

## Health

`GET /healthz` returns `200 ok`. It needs no credentials and does not contact the store.
