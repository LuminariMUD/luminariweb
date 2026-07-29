# Environments

## Environment Matrix

| Environment | URL                                                 | Purpose                                |
| ----------- | --------------------------------------------------- | -------------------------------------- |
| Development | `http://localhost:5190` and `http://localhost:5191` | Local frontend and proxy development   |
| Preview     | `http://localhost:5192`                             | Local preview of built frontend assets |
| Production  | `https://web.luminarimud.com`                       | Cloudflare-hosted app and proxy        |

## Configuration Differences

| Config             | Development                          | Preview                                                | Production                                                               |
| ------------------ | ------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Frontend serving   | Vite dev server                      | Vite preview                                           | Cloudflare Workers Static Assets                                         |
| Proxy/API          | Node Express and `ws`                | Separate server required for `/ws` and `/api/settings` | `worker/index.ts`                                                        |
| WebSocket URL      | Same-origin `/ws` through Vite proxy | `VITE_WS_URL` if needed                                | Same-origin WSS `/ws`                                                    |
| Browser identity   | Selected preset or local MUD         | Selected configured route                              | Fixed logical `luminarimud.com:4100`                                     |
| Physical MUD route | Direct Node `node:net`               | Depends on proxy process                               | Managed mTLS to Apache, then Node and MUD over host loopback             |
| Gateway listener   | `shared/app-settings.ts` or `PORT`   | Depends on proxy process                               | `127.0.0.1:5191`, reachable only through exact-path Apache authorization |
| Bridge role        | None for first-party app             | None for first-party app                               | Node gateway is the protocol endpoint behind Apache; no blind bridge     |

## Environment Variables

| Variable                          | Default           | Purpose                                                                |
| --------------------------------- | ----------------- | ---------------------------------------------------------------------- |
| `PORT`                            | `5191`            | Override the Express and WebSocket server port                         |
| `VITE_WS_URL`                     | same-origin `/ws` | Override the browser WebSocket target                                  |
| `PROXY_PUBLIC_MODE`               | `true`            | Keep proxy in allowlisted public mode when `true`                      |
| `PROXY_ALLOWED_ORIGINS`           | local dev origins | Comma-separated allowed browser origins such as `https://play.example` |
| `PROXY_ALLOWED_DESTINATIONS`      | curated presets   | Comma-separated server-only `host:port` additions                      |
| `PROXY_ALLOW_CUSTOM_DESTINATIONS` | `false` in public | Permit custom public-routable hostnames when explicitly enabled        |
| `PROXY_ALLOW_LOCAL_DESTINATIONS`  | `false`           | Development-only loopback/private target opt-in in private mode        |
| `LOCAL_MUD_PORT`                  | `4100`            | Port for the development-only `127.0.0.1` MUD preset                   |
| `PROXY_CONNECT_TIMEOUT_MS`        | `10000`           | MUD TCP connect timeout, clamped to `1000..30000`                      |
| `PROXY_IDLE_TIMEOUT_MS`           | `300000`          | Connected MUD idle timeout, clamped to `30000..3600000`                |
| `PROXY_DNS_TIMEOUT_MS`            | `3000`            | Destination DNS lookup timeout, clamped to `500..10000`                |
| `PROXY_DNS_RETRY_COUNT`           | `1`               | DNS retry count, clamped to `0..2`                                     |

## Deployment Variables

| Variable               | Default | Purpose                                                                                         |
| ---------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `DEPLOY_WEBHOOK_URL`   | none    | Required by the GitHub Actions deploy workflow to trigger the operator-hosted deployment target |
| `DEPLOY_WEBHOOK_TOKEN` | none    | Optional bearer token sent with the deployment webhook request                                  |

## Production Managed Transport

Production uses configuration boundaries that are intentionally not ordinary
browser or Node environment variables:

| Boundary                     | Required production value                                      |
| ---------------------------- | -------------------------------------------------------------- |
| Wrangler binding             | `MUD_ORIGIN_MTLS` managed certificate ID from `wrangler.jsonc` |
| Worker upstream              | Fixed `https://mud-origin.luminarimud.com/gateway/ws`          |
| Apache client authentication | Dedicated client CA plus current CRL; TLS 1.2 or newer         |
| Node listen address          | `PROXY_LISTEN_HOST=127.0.0.1`                                  |
| Node fixed backend           | `PROXY_FIXED_LOOPBACK_BACKEND_PORT=4100`                       |
| Node allowed origin          | `PROXY_ALLOWED_ORIGINS=https://mud-origin.luminarimud.com`     |
| Public status                | `https://mud-status.luminarimud.com/mtls-health.json`          |

The Worker certificate private key is held in Cloudflare's managed certificate
store and in the root-only production PKI backup. It is not a Wrangler text
secret, `.env` value, or repository file. The public certificate is tracked in
`ops/certificates/` solely for expiry verification.

`/api/settings` intentionally continues to advertise the logical public MUD
identity. It does not disclose the mTLS origin, Apache path, or loopback
gateway.

## Public Deployment Notes

Public Node mode fails closed for browser origins and destinations. An
operator-hosted public Node deployment should set `PROXY_ALLOWED_ORIGINS` to
the deployed HTTPS origin. `PROXY_ALLOWED_DESTINATIONS` is needed only for
vetted MUD routes outside `shared/app-settings.ts`.

The Cloudflare production Worker has a stricter fixed-target policy. Browser
messages must contain the logical Luminari destination, but cannot select the
network route. The Worker can open only its fixed managed-mTLS upstream, and
the production Node gateway can open only the loopback MUD backend.

Malformed destination and origin entries are ignored. Malformed timeout values
fall back to bounded defaults or are clamped to safe limits. Private/operator
custom routing requires `PROXY_PUBLIC_MODE=false` or
`PROXY_ALLOW_CUSTOM_DESTINATIONS=true`; it still permits only public-routable
targets. Local development can separately opt into loopback and private
destinations with `PROXY_PUBLIC_MODE=false` and
`PROXY_ALLOW_LOCAL_DESTINATIONS=true`. That opt-in never permits
metadata-service, link-local, multicast, reserved, unspecified, or banned-port
targets and is ignored in public mode.

## Proxy Modes

Use this default for public production:

```bash
PROXY_PUBLIC_MODE=true
PROXY_ALLOWED_ORIGINS=https://play.example.com
```

Add server-side destinations only after vetting the route:

```bash
PROXY_ALLOWED_DESTINATIONS=mud.example.com:4000
```

Use private mode only in trusted operator environments:

```bash
PROXY_PUBLIC_MODE=false
```

Use a local MUD only on a developer machine:

```bash
PROXY_PUBLIC_MODE=false
PROXY_ALLOW_LOCAL_DESTINATIONS=true
LOCAL_MUD_PORT=4100
```

Use public custom routing only with external abuse controls:

```bash
PROXY_ALLOW_CUSTOM_DESTINATIONS=true
```

Custom routing never permits unsafe networks or banned service ports, but it
does let browser users request arbitrary public-routable hostnames. Treat that
as an operator decision, not the normal public posture.

`PROXY_ALLOW_LOCAL_DESTINATIONS` is not a production escape hatch. Production
uses the separate, fixed `PROXY_FIXED_LOOPBACK_BACKEND_PORT` gateway mode,
whose startup validation requires a loopback listener and ignores
browser-supplied network destinations. Do not reproduce that behavior with the
developer opt-in.

Production transport operations are in the
[mTLS transport runbook](runbooks/mtls-transport.md).

## Bridge Expectations

No environment variable makes a blind bridge compatible with the first-party
React app. `/ws` must terminate at the integrated Luminari Web proxy because it
is a JSON application protocol with Telnet/MSDP state handling behind it.

If an operator runs a bridge, keep it on a separate route or service for a raw
terminal-only path. Bridge TLS, authorization, target maps, rate limits,
timeouts, process supervision, and transcript logging controls are external to
this repository.
