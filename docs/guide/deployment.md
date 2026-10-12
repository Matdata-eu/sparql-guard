# Deployment

sparql-guard is a single stateless Node.js process. Run as many replicas as you need behind a
load balancer. It keeps no state besides the policies it reads from disk.

## Container image

Pull the published image:

```sh
docker pull ghcr.io/matdata-eu/sparql-guard:latest
```

or build it yourself:

```sh
docker build -t sparql-guard .
```

The image runs as a non-root user on a distroless Node.js 22 base and expects its
configuration at `/config/sparql-guard.json`. Override the path with `SPARQL_GUARD_CONFIG`.
Policy paths in the configuration are relative to the configuration file, so the simplest
layout is one folder:

```text
/config/
  sparql-guard.json
  policies.ttl
```

```sh
docker run -p 8080:8080 -v "$PWD/config:/config:ro" \
  -e SPARQL_GUARD_UPSTREAM=http://store:3030/ds/sparql \
  ghcr.io/matdata-eu/sparql-guard:latest
```

| Variable | Effect |
| --- | --- |
| `SPARQL_GUARD_CONFIG` | Path of the configuration file. |
| `SPARQL_GUARD_UPSTREAM` | Overrides `upstream` from the file. |
| `PORT` | Overrides `port` from the file. |
| anything else | Available in the configuration as `${NAME}`. |

## Docker Compose

```yaml
services:
  store:
    image: stain/jena-fuseki:5.1.0
    environment:
      ADMIN_PASSWORD: change-me
    # No published port: only the guard can reach the store.

  guard:
    image: ghcr.io/matdata-eu/sparql-guard:latest
    environment:
      SPARQL_GUARD_UPSTREAM: http://store:3030/ds/sparql
    volumes:
      - ./config:/config:ro
    ports:
      - "8080:8080"
```

The repository's own [`docker-compose.yml`](https://github.com/Matdata-eu/sparql-guard/blob/main/docker-compose.yml)
is a complete example with Oxigraph, see [Playground](./playground).

## Kubernetes

Keep the configuration and the policies in a ConfigMap, the API key hashes and store
credentials in a Secret, and make sure the store only accepts traffic from the guard.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: sparql-guard
data:
  sparql-guard.json: |
    {
      "upstream": "http://fuseki:3030/ds/sparql",
      "upstreamHeaders": { "Authorization": "Basic ${STORE_BASIC_AUTH}" },
      "policies": ["policies.ttl"],
      "auth": {
        "trustedHeaders": { "agent": "x-forwarded-email", "groups": "x-forwarded-groups",
                            "agentPrefix": "mailto:" }
      },
      "watchPolicies": true
    }
  policies.ttl: |
    @prefix sg: <https://matdata.eu/ns/sparql-guard#> .
    <urn:policy:staff> a sg:Policy ;
      sg:agent sg:AuthenticatedAgent ;
      sg:readGraph <https://example.org/graph/intranet> .
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sparql-guard
spec:
  replicas: 2
  selector:
    matchLabels: { app: sparql-guard }
  template:
    metadata:
      labels: { app: sparql-guard }
    spec:
      containers:
        - name: sparql-guard
          image: ghcr.io/matdata-eu/sparql-guard:latest
          ports: [{ containerPort: 8080 }]
          env:
            - name: STORE_BASIC_AUTH
              valueFrom: { secretKeyRef: { name: sparql-guard, key: store-basic-auth } }
          volumeMounts:
            - { name: config, mountPath: /config, readOnly: true }
          readinessProbe:
            httpGet: { path: /healthz, port: 8080 }
          livenessProbe:
            httpGet: { path: /healthz, port: 8080 }
          resources:
            requests: { cpu: 50m, memory: 96Mi }
            limits: { memory: 256Mi }
      volumes:
        - name: config
          configMap: { name: sparql-guard }
```

::: tip Policy updates without restarts
Kubernetes updates mounted ConfigMaps in place after a short delay. With
`"watchPolicies": true` the proxy picks up the new policies by itself. If the new version
does not load, the previous one stays active and the error is logged.
:::

::: info Image tags
The Docker workflow publishes `ghcr.io/matdata-eu/sparql-guard` for `linux/amd64` and
`linux/arm64`: `latest` and `main` follow the main branch, `1.2.3` and `1.2` are created from
`v1.2.3` tags, and every build is also tagged `sha-<commit>`. Pin a version or a `sha-` tag in
production.
:::

Restrict access to the store so that only the guard can query it:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: store-only-from-guard
spec:
  podSelector:
    matchLabels: { app: fuseki }
  ingress:
    - from:
        - podSelector:
            matchLabels: { app: sparql-guard }
```

## Behind oauth2-proxy

[oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/) signs users in with your identity
provider and passes the identity in headers. Run it in front of sparql-guard and configure
sparql-guard to trust those headers:

```sh
oauth2-proxy \
  --upstream=http://sparql-guard:8080/ \
  --set-xauthrequest=true \
  --pass-user-headers=true \
  --provider=oidc --oidc-issuer-url=https://login.example.org/realms/main \
  --client-id=sparql --client-secret-file=/secrets/client-secret \
  --cookie-secret-file=/secrets/cookie-secret \
  --email-domain='*'
```

```json
"trustedHeaders": {
  "agent": "x-forwarded-email",
  "groups": "x-forwarded-groups",
  "agentPrefix": "mailto:"
}
```

oauth2-proxy sets `X-Forwarded-Email` and `X-Forwarded-Groups` and replaces any values the
client sent. Check the header names your oauth2-proxy version and provider produce, and point
`agent` and `groups` at them. Agents then look like `mailto:jan@example.org`; use the same
IRIs in your data and policies.

## Operations

- **Health:** `GET /healthz` returns `200 ok` once the policies are loaded.
- **Logs:** one line per request on stdout: method, path, agent, status, duration. Queries are
  not logged.
- **Reloading:** change the files with `watchPolicies`, or send `SIGHUP`.
- **Timeouts:** `timeoutMs` (default 60 s) limits each upstream request. Keep it below your
  load balancer's timeout.
- **Explain endpoint:** keep `explain` off in production unless callers may see the rewritten
  query. It reveals the structure of the policies that apply to them.
