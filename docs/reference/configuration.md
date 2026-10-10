# Configuration

The server reads one JSON file, by default `sparql-guard.json` in the working directory. Set
another path with `--config` or `SPARQL_GUARD_CONFIG`.

```json
{
  "upstream": "http://fuseki:3030/ds/sparql",
  "upstreamHeaders": { "Authorization": "Basic ${STORE_BASIC_AUTH}" },
  "host": "0.0.0.0",
  "port": 8080,
  "path": "/sparql",
  "policies": ["policies.ttl", "more-policies.trig"],
  "auth": {
    "apiKeys": [
      { "sha256": "…", "agent": "https://example.org/people/jan", "groups": ["staff"] }
    ],
    "trustedHeaders": {
      "agent": "x-forwarded-user",
      "groups": "x-forwarded-groups",
      "agentPrefix": "https://example.org/people/"
    },
    "anonymous": false
  },
  "graphSpanningChecks": true,
  "explain": false,
  "watchPolicies": true,
  "timeoutMs": 60000
}
```

## Options

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `upstream` | string | **required** | SPARQL query endpoint of the store. Queries are sent as `POST` with `application/x-www-form-urlencoded`. |
| `upstreamHeaders` | object | `{}` | Extra headers sent to the store, typically its credentials. |
| `host` | string | `0.0.0.0` | Interface to listen on. Use `127.0.0.1` when an authenticating proxy runs next to it. |
| `port` | number | `8080` | Port to listen on. |
| `path` | string | `/sparql` | Path of the SPARQL endpoint. The explain endpoint is `<path>/explain`. |
| `policies` | string[] | **required** | Policy files in Turtle (`.ttl`) or TriG (`.trig`), relative to the configuration file. |
| `auth.apiKeys` | object[] | none | API keys; see below. |
| `auth.trustedHeaders` | object | none | Identity from an authenticating proxy; see below. |
| `auth.anonymous` | boolean | `false` | Accept requests without credentials. |
| `graphSpanningChecks` | boolean | `true` | Evaluate policy checks across all readable graphs. Set to `false` only if all triples about a resource are in one graph; checks then only look at the graph the pattern is matched in, which is faster. |
| `explain` | boolean | `false` | Serve `<path>/explain`, which returns the rewritten query. |
| `watchPolicies` | boolean | `false` | Reload the policy files when they change (polled every 2 s). |
| `timeoutMs` | number | `60000` | Timeout for each upstream request. |

### `auth.apiKeys[]`

| Key | Description |
| --- | --- |
| `sha256` | Hex SHA-256 of the key, from `sparql-guard hash-key <key>`. |
| `agent` | Agent IRI for requests with this key. |
| `groups` | Group names, optional. |

### `auth.trustedHeaders`

| Key | Description |
| --- | --- |
| `agent` | Name of the header with the user (case-insensitive). |
| `groups` | Name of the header with comma-separated groups, optional. |
| `agentPrefix` | Prepended to user names that are not IRIs. Default `urn:sparql-guard:user:`. |

See [Authentication](../guide/authentication) for how the three methods interact.

## Environment variables

| Variable | Effect |
| --- | --- |
| `SPARQL_GUARD_CONFIG` | Configuration file for `serve`. |
| `SPARQL_GUARD_UPSTREAM` | Replaces `upstream`. |
| `PORT` | Replaces `port`. |

Any string in the file may contain `${NAME}`, which is replaced by the environment variable
`NAME`. A reference to an unset variable stops the server from starting, so a missing secret
cannot turn into an empty credential.
