# Deployment

## Build

```bash
npm install
npm run build
```

The build writes frontend assets to `dist/client` and server output to `dist/server`.

For Cloudflare validation and deployment:

```bash
npm run cloudflare:dry-run
npm run cloudflare:deploy
```

Wrangler deploys `worker/index.ts`, `dist/client`, the Workers preview URL, and
the `web.luminarimud.com` custom domain from `wrangler.jsonc`.

## Local Production Run

```bash
npm start
curl http://localhost:5191/health
```

`npm start` runs `node dist/server/index.js`. The server serves the built frontend, `/api/settings`, `/health`, and `/ws`.

## Production Topology

The active public topology is Cloudflare Workers with Static Assets:

```text
Browser at https://web.luminarimud.com
  |-- HTTPS static app and GET /api/settings
  |-- WSS /ws
  v
Cloudflare Worker + Workers Static Assets
  |-- fixed managed-mTLS WSS through MUD_ORIGIN_MTLS
  v
mud-origin.luminarimud.com:443/gateway/ws
  |-- exact-name Apache client-certificate authorization
  v
127.0.0.1:5191 Luminari Node gateway
  |-- fixed loopback Telnet
  v
127.0.0.1:4100 LuminariMUD
```

The Worker is the integrated proxy because `/ws` is a structured application
protocol, not raw Telnet bytes. It validates browser admission and relays only
to a fixed managed-mTLS WebSocket. The loopback Node gateway reuses the
existing `MudSession` implementation to validate application messages,
negotiate Telnet/MSDP, map state for the UI, and emit sanitized connection
statuses. Browser-supplied data cannot change the physical origin or loopback
backend.

The ordinary Express and `ws` mode remains available for local development and
private operator-hosted deployments. Standalone byte bridges are not
compatible replacements for the first-party React app. See
[Production Deployment](deploy-production.md) and
[Bridge Deployment Options](bridge-deployment-options.md).

The browser-to-Cloudflare and Worker-to-origin legs are protected by TLS. The
second leg also authenticates the dedicated Worker client certificate. Apache
and the Node gateway run on the MUD host; both Node-to-Node and Node-to-MUD
connections are loopback-only. The Worker has no direct-TCP or plaintext
fallback.

Public port `4100` remains enabled for legacy direct Telnet users. That
separate route is plaintext and is not used by the web deployment. Full
deployment, rotation, revocation, and security-rollback procedures are in the
[mTLS transport runbook](runbooks/mtls-transport.md).

Native Luminari-Source WebSocket support is deferred by
[ADR 0003](adr/0003-native-websocket-transport-direction.md). Do not expose or
document a source-native listener as the first-party browser transport until a
future source transport spec, browser contract spec, security review,
operations runbook, compatibility tests, and rollback drill all pass.

## Health Probe

`GET /health` returns HTTP 200 JSON with `{ "ok": true }`. Local production verification:

```bash
curl -fsS http://localhost:${PORT:-5191}/health
```

For the Cloudflare production route, also check the content-free host state:

```bash
curl -fsS https://web.luminarimud.com/health
curl -fsS https://mud-status.luminarimud.com/mtls-health.json | jq
```

The scheduled `mtls-security` workflow rejects stale/unhealthy status, DNS or
hostname changes, missing-client-certificate acceptance, raw Telnet on the TLS
probe port, and certificate expiry thresholds.

For PM2 or other operator-hosted deployments, configure the load balancer,
reverse proxy, or uptime monitor to check `https://<origin>/health` and alert
or restart on non-200 responses. PM2 does not provide an in-repository HTTP
probe, so this is a deployment-platform setting.

## Security Controls

The built server applies application-level proxy guardrails before opening a
MUD socket:

- HTTP requests are rate limited per IP with `429 Too Many Requests` and `Retry-After` headers.
- Browser command input sent over `/ws` is throttled per socket.
- Excessive concurrent WebSocket connections from one IP are rejected.
- Public proxy mode is enabled by default and allows only curated MUD presets plus server-only `PROXY_ALLOWED_DESTINATIONS` entries.
- Unexpected WebSocket origins are rejected in public mode before quota acquisition or MUD socket creation.
- Destinations are checked for banned service ports, unsafe direct IP literals, DNS failures, private ranges, loopback, link-local, multicast, reserved ranges, and metadata-service targets.
- Connect and idle timeouts close the active MUD socket with sanitized status details.
- Player command text is not intentionally logged or included in policy, socket, or timeout errors.

Production adds these fixed transport controls:

- `MUD_ORIGIN_MTLS` is the only Worker MUD-origin capability.
- The upstream URL and Origin header are constants.
- The browser upgrade succeeds only after the authenticated upstream
  WebSocket exists.
- Apache requires the dedicated client certificate in the initial handshake
  and authorizes only `/gateway/ws`.
- The gateway binds only `127.0.0.1:5191` and dials only
  `127.0.0.1:4100`.
- Missing, invalid, expired, or revoked credentials fail closed without a
  direct port-`4100` retry.
- Worker observability is disabled for player content, and operational logs
  contain no application frames or payloads.

Public deployments should still place a WAF or equivalent reverse-proxy rule set in front of the app:

- Allow only the deployed browser origin to reach `/api/settings`, `/health`, and `/ws`.
- Block obvious scan and bot traffic before it reaches the Node process.
- Rate limit abusive requests at the edge even though the app already enforces per-IP request limits.
- Keep the WAF policy aligned with the same public origin that is used in `PROXY_ALLOWED_ORIGINS`.

Recommended public-mode environment:

```bash
PROXY_PUBLIC_MODE=true
PROXY_ALLOWED_ORIGINS=https://play.example.com
PROXY_ALLOWED_DESTINATIONS=extra-mud.example.com:4000
PROXY_CONNECT_TIMEOUT_MS=10000
PROXY_IDLE_TIMEOUT_MS=300000
PROXY_DNS_TIMEOUT_MS=3000
PROXY_DNS_RETRY_COUNT=1
```

`PROXY_ALLOWED_DESTINATIONS` is optional when the curated presets are the only public routes. Use comma-separated `host:port` pairs for additions. Malformed entries are ignored, and banned service ports remain blocked.

Public operators should verify this checklist before exposing the service:

- Serve the browser app over HTTPS and reach `/ws` over WSS from the same public origin unless `VITE_WS_URL` is intentionally configured.
- Set `PROXY_ALLOWED_ORIGINS` to the exact deployed browser origin.
- Keep `PROXY_PUBLIC_MODE=true` unless the deployment is a trusted private operator environment.
- Add only vetted MUD routes to `PROXY_ALLOWED_DESTINATIONS`.
- Confirm the reverse proxy forwards WebSocket upgrades to `/ws` and does not strip the `Origin` header.
- Probe `/health` through the public HTTPS origin and alert on non-200 responses.
- Keep player command text out of proxy, reverse-proxy, bridge, packet-capture, and incident logs by default.
- Keep account names, passwords, onboarding actions, and character lists out of
  those logs as well.

Private or operator deployments can allow browser-supplied public-routable hostnames:

```bash
PROXY_PUBLIC_MODE=false
```

or, for a public-mode process that still permits custom hostnames:

```bash
PROXY_ALLOW_CUSTOM_DESTINATIONS=true
```

Custom routing does not disable private-network, reserved-network, metadata-service, DNS, or banned-port checks. For public hosting, still configure HTTPS termination, CDN or reverse-proxy protections, WAF rules, process supervision, and host-level firewall controls outside this repository.

For local paired development only, loopback and private MUD targets can be
enabled explicitly:

```bash
PROXY_PUBLIC_MODE=false
PROXY_ALLOW_LOCAL_DESTINATIONS=true
LOCAL_MUD_PORT=4100
```

This adds a development-only `127.0.0.1` preset. The local-destination flag is
ignored in public mode and never permits metadata-service, link-local,
multicast, reserved, or unspecified targets.

## Bridge Fallbacks

Do not point the first-party React app's `/ws` endpoint at a blind
WebSocket-to-TCP bridge. A bridge cannot speak the app JSON message contract or
produce MSDP-backed UI state. If a bridge is needed, operate it as a separate
terminal-only path with fixed or mapped targets, TLS, authorization, rate
limits, timeout policy, and recording/TCP-dump features disabled by default for
player traffic. The decision criteria and rollback steps are in
[Bridge Fallback Runbook](runbooks/bridge-fallback.md).

If a future native source WebSocket experiment is deployed, keep the integrated
proxy route available as rollback. Roll back by disabling the experimental
listener or route and returning browser clients to the known-good `/ws` proxy
until the source-native path has its own approved production runbook.

## PM2 Run

```bash
npm install
npm run build
pm2 start dist/server/index.js --name luminari-web-client
```

Optional ecosystem file:

```bash
pm2 start ecosystem.config.cjs
```

Useful commands:

```bash
pm2 status
pm2 logs luminari-web-client
pm2 restart luminari-web-client
pm2 stop luminari-web-client
pm2 delete luminari-web-client
```

## CI/CD Pipeline

The repository includes a manual GitHub Actions deploy workflow at [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml). It builds the app and posts a deployment webhook when the required secret is configured.

Required secret:

| Variable               | Purpose                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `DEPLOY_WEBHOOK_URL`   | Deployment trigger endpoint for the operator-hosted production environment |
| `DEPLOY_WEBHOOK_TOKEN` | Optional bearer token for webhook authentication                           |

The workflow can be run from the GitHub Actions UI and pointed at a branch or tag ref. It uses `scripts/deploy-webhook.mjs` to send build metadata, rollback guidance, and the source revision to the deployment trigger.

Local release verification remains:

```bash
npm run lint
npm run build
curl http://localhost:5191/health
```

## Rollback

For the Cloudflare production route, roll back to the previous approved secure
Worker version and then confirm `/health`, public mTLS health, a fresh browser
session, and the gateway/loopback socket topology:

```bash
npx wrangler rollback <secure-version-id> \
  --name luminari-web \
  --message 'Secure transport rollback: <reason>' \
  --yes \
  --env-file /dev/null
```

If no secure version is usable, keep web login fail closed while repairing it.
The pre-mTLS Worker is a security rollback: it restores plaintext credentials
and player content on the public Worker-to-MUD leg. It requires an explicit,
informed operator decision, an incident record, player notice, and reopening
`ONBOARD-SEC-001`. It must never be an automatic runtime fallback.

For the ordinary Node/PM2 deployment, redeploy the previous approved git
revision or release artifact through the same webhook or PM2 process, then
confirm `/health` and WebSocket reconnect behavior.

Rollback when the health check fails after deploy, the app cannot establish
WebSocket connections, or critical connection behavior regresses. See the
[mTLS transport runbook](runbooks/mtls-transport.md) for the complete cutover,
session-drain, certificate, and compromise procedures.
