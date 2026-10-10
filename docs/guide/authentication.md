# Authentication

sparql-guard *authorizes*: it decides what an identity may see. Establishing the identity can
happen in three ways, configured under `auth` in the
[configuration](../reference/configuration). They are tried in this order:

1. an **API key**, if the request carries one and keys are configured;
2. **trusted headers**, if configured and the agent header is present;
3. **anonymous**, if allowed.

If none applies, the request gets `401 Unauthorized`.

The result is always an *agent* (an IRI, or none for anonymous) plus a list of *groups*.
Policies match on those through `sg:agent` and `sg:group`.

## API keys

Good for machine clients, scripts and small teams.

```json
{
  "auth": {
    "apiKeys": [
      {
        "sha256": "9cca4fb4d7e3842c2fad316d5f496cdd3549e79828d778967e0983d2590c333f",
        "agent": "https://example.org/people/jan",
        "groups": ["maintenance-north"]
      }
    ]
  }
}
```

Only the SHA-256 hash of a key is stored. Generate a random key and hash it:

```sh
KEY=$(openssl rand -hex 24)
echo "key: $KEY"
sparql-guard hash-key "$KEY"
```

Clients send the key in either header:

```http
Authorization: Bearer <key>
X-API-Key: <key>
```

A request with a key that does not match gets `401`. It is **not** treated as anonymous, so a
typo shows up as an error instead of an unexpectedly small result.

## Trusted headers

Good when users already sign in through an identity provider (Keycloak, Entra ID, Okta, …)
via an authenticating reverse proxy such as [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/),
an ingress controller with external auth, or an API gateway. The proxy authenticates the user
and passes the identity on in headers:

```json
{
  "auth": {
    "trustedHeaders": {
      "agent": "x-forwarded-user",
      "groups": "x-forwarded-groups",
      "agentPrefix": "https://example.org/people/"
    }
  }
}
```

| Key | Meaning |
| --- | --- |
| `agent` | Header holding the user. A value that is already an IRI (`https://…`, `urn:…`, `mailto:…`) is used as is. Otherwise it is URL-encoded and appended to `agentPrefix`. |
| `groups` | Optional header with comma-separated group names. |
| `agentPrefix` | Prefix for plain user names. Default `urn:sparql-guard:user:`. |

With the configuration above, `x-forwarded-user: jan` becomes the agent
`https://example.org/people/jan`, and `x-forwarded-groups: staff, maintenance-north` gives the
groups `staff` and `maintenance-north`.

::: danger Only behind a proxy
sparql-guard believes these headers. Anyone who can send requests to sparql-guard directly can
claim to be anyone. Make sure that:

- sparql-guard is only reachable through the authenticating proxy (for example with a
  Kubernetes `NetworkPolicy`, or by listening on `127.0.0.1` in the same pod);
- the proxy **overwrites** the headers on every request rather than passing on what the client
  sent.
:::

An example with oauth2-proxy is in [Deployment](./deployment#behind-oauth2-proxy).

## Anonymous access

```json
{ "auth": { "anonymous": true } }
```

Requests without credentials are accepted with no agent and no groups. They match only
policies with `sg:agent sg:Anyone`. In shapes, `sg:requestingAgent` is
`urn:sparql-guard:anonymous` for them, which matches no real data.

## Mapping identities to your data

`sg:requestingAgent` compares the agent IRI with values in your data, so the two must line up.
Common patterns:

- Use the same IRIs in the data that the identity provider produces through `agentPrefix`, for
  example `https://example.org/people/jan`.
- Link a person in the data to the account IRI, and point the shape's path at that link:
  `sh:path ( ex:assignedTo ex:account )`.

## Credentials for the store

The proxy's own credentials for the store are separate from the callers' credentials. Pass
them with `upstreamHeaders`, reading secrets from environment variables:

```json
{
  "upstream": "https://graphdb.internal/repositories/main",
  "upstreamHeaders": { "Authorization": "Basic ${GRAPHDB_BASIC_AUTH}" }
}
```

Give that store account read access only.
