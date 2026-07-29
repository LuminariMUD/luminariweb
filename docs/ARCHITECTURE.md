# Architecture

## System Overview

Luminari Web is a TypeScript application with a React browser client, a
Cloudflare Worker production edge, and an integrated Node protocol gateway.
The browser cannot open Telnet sockets directly, so it uses the typed `/ws`
application protocol. The Node gateway owns Telnet negotiation, MSDP parsing,
structured onboarding, terminal translation, and MUD-session lifecycle.

Production separates the public edge from protocol processing:

```text
Browser at web.luminarimud.com
  |-- HTTPS static assets and GET /api/settings
  |-- WSS /ws
  v
Cloudflare Worker and Static Assets
  |-- fixed managed-mTLS WSS
  v
mud-origin.luminarimud.com:443/gateway/ws
  |-- exact-name Apache client-certificate authorization
  v
127.0.0.1:5191 Node protocol gateway
  |-- fixed loopback Telnet
  v
127.0.0.1:4100 LuminariMUD
```

Local development uses the same Node gateway directly and retains the ordinary
allowlisted `node:net` destination path. The production Worker never opens
public Telnet port `4100`.

## Components

### Browser Client

- **Purpose**: Render structured account and character onboarding, terminal
  output, connection controls, HUD bars, side panels for character, combat,
  group, affects, inventory, room, map, and quest data, plus aliases, triggers,
  settings, and import/export controls.
- **Tech**: React, TypeScript, CSS, Vite.
- **Location**: `src/`

### Proxy Server

- **Purpose**: In local/operator mode, serve health, settings, frontend, and
  onboarding media assets. In all Node modes, accept typed browser messages,
  connect to the permitted MUD target, negotiate Telnet options, validate
  onboarding state and actions, parse MSDP, and forward typed updates.
- **Tech**: Express, `ws`, Node `net`, TypeScript.
- **Location**: `server/`

### Cloudflare Production Edge

- **Purpose**: Serve static assets and same-origin HTTP contracts, enforce
  browser Origin and per-IP connection admission, establish the fixed
  authenticated origin WebSocket, and relay text/binary frames without
  interpreting the application protocol.
- **Tech**: Cloudflare Workers Static Assets, `WebSocketPair`, managed-mTLS
  `Fetcher`.
- **Location**: `worker/`, `wrangler.jsonc`.

### Production Origin Gateway

- **Purpose**: Authenticate the dedicated Worker client certificate, authorize
  only `/gateway/ws`, proxy to the loopback Node gateway, and constrain the
  Node gateway to the loopback MUD backend.
- **Tech**: Apache `mod_ssl`/WebSocket proxying, systemd, Node gateway runtime.
- **Location**: `ops/apache/`, `ops/systemd/`, `server/gateway-runtime.ts`.

### Shared Protocol and Settings

- **Purpose**: Define app settings, MUD presets, browser/server message types, MSDP variable mappings, shared MSDP mapping helpers, and client-visible MUD state fields and display models.
- **Tech**: TypeScript.
- **Location**: `shared/`
- **Protocol status**: [`shared/protocol-feature-status.ts`](../shared/protocol-feature-status.ts) is the typed catalog for supported, partial, rejected, deferred, and validation-gap protocol claims.

## Runtime Data Flow

1. Browser loads app settings from `GET /api/settings`.
2. Browser opens `WebSocket /ws`.
3. In production, the Worker validates same-origin admission and acquires the
   per-IP connection lease.
4. Before returning HTTP `101` to the browser, the Worker opens the fixed
   upstream WebSocket through `MUD_ORIGIN_MTLS`. Apache has therefore completed
   server and client certificate authentication before the browser upgrade
   succeeds.
5. Apache proxies only `/gateway/ws` to `127.0.0.1:5191`. The gateway validates
   the logical `luminarimud.com:4100` connect message but its injected socket
   factory always dials `127.0.0.1:4100`.
6. In local/operator mode, the Node server instead validates the browser
   message, origin policy, destination allowlist, banned ports, and network
   safety before opening its configured Telnet socket.
7. The Telnet parser forwards text as `terminal` messages. When MSDP is
   available, the gateway sends client identity and report requests for
   configured variables.
8. Parsed MSDP updates are normalized by `shared/msdp-state.ts`, mapped to
   partial `MudState` objects, and converted by shared display helpers into
   explicit panel states.
9. Browser command and onboarding messages pass through the same session; the
   gateway validates them before writing accepted bytes to the MUD.
10. A close or error on the browser, Worker upstream, gateway, or MUD leg
    closes its paired session and releases connection accounting.

Structured account and character onboarding uses the same connection. The
proxy advertises `LUMINARI_ONBOARDING_VERSION=1`, requests
`LUMINARI_ONBOARDING`, validates the returned bounded state, and exposes typed
onboarding messages through `/ws`. The MUD remains authoritative for
authentication, choices, restrictions, mutation, and saving. Unsupported MUDs
ignore the capability and continue through the classic terminal. See
[Structured Account and Character Onboarding](structured-onboarding.md).

Shared fixture tests load `tests/fixtures/msdp/manifest.json` and exercise the
same mapping helpers without a live MUD connection.

## Deployment Boundary

Cloudflare terminates the browser HTTPS/WSS connection and necessarily sees
session plaintext in Worker memory. The second public network leg is a separate
TLS connection authenticated in both directions. After Apache termination,
the Node and MUD legs remain on host loopback.

The production browser continues to see the logical destination
`luminarimud.com:4100`. That value preserves the application contract but
cannot select the physical route. The Worker upstream URL and Origin are
constants, and fixed-loopback gateway mode refuses to start unless the Node
listener is `127.0.0.1`.

Public port `4100` remains available for legacy direct Telnet players. It is a
separate plaintext service and is never a Worker fallback.

### Managed-mTLS Origin Decision

The production Worker uses the supported
[`MUD_ORIGIN_MTLS` certificate binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/mtls/)
to open
`https://mud-origin.luminarimud.com/gateway/ws`. The hostname remains DNS-only
so the client certificate reaches the exact origin. Apache requires the
dedicated client certificate in the initial TLS handshake, checks the current
CRL, and authorizes only the fixed WebSocket path. Public aggregate health is
served separately at `mud-status.luminarimud.com`.

This design was selected because it:

- preserves the deployed same-origin browser boundary;
- reuses the existing Node `MudSession` instead of creating a second
  Telnet/MSDP/onboarding implementation;
- authenticates the Worker without relying on unstable egress IP allowlists;
- keeps browser-selected data out of physical routing; and
- can fail closed without changing MUD persistence or gameplay data.

The following are architectural invariants:

- The browser upgrade succeeds only after the managed-mTLS origin returns an
  upstream WebSocket.
- The Worker relays text as text and binary data as binary data; only the Node
  gateway interprets the application protocol.
- Close/error handling is symmetric and releases the Worker connection lease
  exactly once.
- Certificate, hostname, upstream, or relay failures expose only a generic
  error and never retry `node:net`, `node:tls`, or public port `4100`.
- The client private key is stored only in Cloudflare's managed certificate
  store and the root-only production PKI backup. The repository tracks only
  the public certificate needed for expiry checks.
- TLS-service, Worker, gateway, and monitoring logs contain connection or
  verification metadata only, never application payloads.

A deployed canary proved that direct Worker
[`node:tls`](https://developers.cloudflare.com/workers/runtime-apis/nodejs/tls/)
did not present the configured client certificate, so that path remains
rejected. TLS without certificate validation, silent TLS-to-Telnet fallback,
source-IP allowlisting alone, and direct Worker access to private/loopback MUD
addresses are also rejected. Adding TLS directly to Luminari-Source remains
possible long term, but would expand C runtime, compatibility, and rollout
scope without improving the current contained boundary. A Node gateway behind
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/)
remains a viable future fallback if managed-mTLS fetching becomes unavailable,
but it requires its own tunnel identity and operations boundary.

The retained stunnel listener on public port `54443` is an independent
certificate, CRL, TLS-version, and raw-Telnet negative probe. It is not in the
player route.

### Security Scope

The managed-mTLS boundary protects credentials, commands, terminal output,
structured onboarding, and private RP content from passive or active
observation between Cloudflare and the MUD host. It authenticates both the
exact origin and the dedicated Worker identity and prevents accidental
plaintext downgrade.

It does not provide encryption through a compromised Cloudflare Worker or
after TLS termination, protect a compromised Cloudflare account/MUD host/game
process, encrypt legacy direct Telnet, or encrypt player files at rest.
Application-level password, origin, destination, rate-limit, and logging
controls remain independently required.

Standalone WebSocket-to-TCP bridges are blind byte forwarders from this
architecture's point of view. They do not understand the browser JSON `/ws`
contract, Telnet/MSDP state mapping, reconnect cleanup, or UI status semantics.
If an operator needs more isolation, isolate the integrated proxy first through
process, host, container, network, reverse-proxy, or firewall boundaries. Bridge
fallbacks belong on separate terminal-only paths. The full decision is in
[Bridge Deployment Options](bridge-deployment-options.md).

Native Luminari-Source WebSocket support is deferred by
[ADR 0003](adr/0003-native-websocket-transport-direction.md). A future native
listener would need its own source descriptor lifecycle, browser contract,
security controls, operations posture, compatibility tests, and rollback before
it can replace or bypass the integrated proxy.

### Transport Regression Boundary

Transport changes must retain four independent evidence layers:

| Boundary                  | Required coverage                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker relay              | Fixed URL/Origin, upstream-before-browser upgrade, frame fidelity, generic failures, symmetric close/error cleanup, and single lease release in `tests/worker-websocket-relay.test.ts` |
| Node gateway              | Fail-closed listen-host parsing and an injected socket factory that always dials `127.0.0.1:4100` in `tests/gateway-runtime.test.ts`                                                   |
| TLS failures              | Real certificate, hostname, client-authentication, and zero-backend-connection failures in `tests/mud-tls-synthetic.test.ts`                                                           |
| Application compatibility | Protocol v1/v2, Telnet/MSDP, editors, terminal, resize, heartbeat, close, and reconnect through mutual TLS in `tests/onboarding-v2-synthetic.test.ts`                                  |

`npm test` runs the TypeScript unit/integration layer. Playwright remains a
separate `npm run test:e2e` gate for desktop, `390px`, and `360px` browser
flows. Existing proxy lifecycle, network, policy, and deployment-policy suites
remain required when their boundaries change. Production validation and
privacy-safe packet-capture requirements are owned by the
[mTLS operations runbook](runbooks/mtls-transport.md).

## Terminal Rendering

The production terminal renderer remains the escaped `ansi-to-html` HTML path. Terminal and panel rich text use shared helpers under `src/terminal/render-mud-html.ts` so XML escaping and Luminari color conversion stay centralized and testable.

An xterm.js renderer spike is available only through `?terminalRenderer=xterm-spike`. It consumes the same raw terminal stream, disables xterm stdin, keeps the existing command input authoritative, and routes fit-derived dimensions through the existing resize pathway. The staged migration decision is recorded in [adr/0001-terminal-renderer.md](adr/0001-terminal-renderer.md).

## HTTP Endpoints

| Endpoint            | Purpose                                                         |
| ------------------- | --------------------------------------------------------------- |
| `GET /health`       | Returns `{ "ok": true }` for local and deployment health checks |
| `GET /api/settings` | Returns runtime settings from `shared/app-settings.ts`          |
| `GET /*`            | Serves built frontend assets outside development                |

WebSocket details are documented in [api/http-and-websocket.md](api/http-and-websocket.md).

## Protocol Support Boundary

The current supported protocol path is uncompressed browser JSON over `/ws`, an
integrated proxy Telnet socket, and MSDP-backed state mapping. Maintainers
should use the [Protocol Feature Checklist](protocol-feature-checklist.md) and
[ADR 0002](adr/0002-mccp-and-gmcp-protocol-direction.md) before changing or
claiming MCCP or GMCP support.

Current high-level boundaries:

- Client and proxy support ANSI terminal rendering, UTF-8 decoding, TTYPE,
  NAWS, and MSDP for the documented app workflow.
- The proxy rejects MCCP, MXP, and CHARSET today. MCCP remains rejected until
  source compression and proxy decompression are implemented and tested.
- GMCP remains deferred until source modules, schemas, proxy parsing, client
  mappings, MSDP coexistence, fixtures, and rollback are planned.
- MSP, MSSP consumption, native source WebSocket, live `DAMAGE_BONUS`, and
  structured `QUEST_INFO` remain source-level or validation-gap work.
- `TITLE`, saves, and `MINIMAP` are source-backed MSDP defaults, but older
  servers may still omit them and must keep explicit fallback states.

The UI can expose these boundaries as static protocol status. It must not infer
live negotiation state unless the browser already receives reliable state for
that feature.

## Tech Stack Rationale

| Technology         | Purpose                         | Why Chosen                                                                     |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------------ |
| TypeScript         | Shared app language             | Keeps frontend, server, Worker, and protocol contracts typed                   |
| React              | Browser UI                      | Matches the current app and supports stateful panels                           |
| Vite               | Development and build           | Provides fast development and production bundling                              |
| Cloudflare Workers | Production HTTP/WebSocket edge  | Serves static assets and supports a managed client-certificate binding         |
| Apache and systemd | Authenticated origin boundary   | Enforce initial mTLS/CRL checks, exact-path proxying, and loopback confinement |
| Express and `ws`   | Integrated Node gateway         | Provide local/operator HTTP and the shared application-protocol endpoint       |
| Node `net`         | Gateway-to-MUD Telnet transport | Reuses the tested `MudSession`; production use is confined to host loopback    |
| `ansi-to-html`     | Terminal rendering              | Current renderer for ANSI-colored terminal text                                |
| xterm.js           | Terminal spike                  | Preferred long-term renderer candidate, gated behind an opt-in spike           |

## Data Layer

There is no web-application database. Settings, aliases, triggers, layout, and
onboarding audio preferences are browser-local. Automation configuration uses a
versioned `localStorage` contract and can be imported or exported through the
UI. Legacy cookie values are read only for one-way migration and then removed.
Credentials, commands, transcripts, and private onboarding drafts are not
persisted there.

## Security Posture

The proxy now defaults to public-mode guardrails before opening outbound MUD
sockets. It checks WebSocket origins, destination allowlists, banned service
ports, direct IP literals, DNS results, unsafe networks, metadata-service
targets, HTTP request rates, active WebSocket counts, per-socket command rates,
duplicate in-flight connects, connect timeouts, idle timeouts, and DNS timeout
settings. Policy and timeout errors use stable sanitized details and do not
intentionally include player command text.

Production adds a fail-closed managed-mTLS route between the Worker and the
exact-name origin. Apache requires the dedicated Worker certificate, validates
its issuer and CRL, and exposes only the fixed WebSocket path to a
loopback-bound gateway. The Worker has no direct TCP, TLS, or plaintext
fallback. Public direct Telnet remains a distinct plaintext legacy service,
not part of the browser route.

Public deployments also require host firewalling, process supervision, health
checks, alert delivery, certificate rotation/revocation, and
log-retention/redaction controls. The operational source of truth is the
[mTLS transport runbook](runbooks/mtls-transport.md).

## Key Decisions

Settled transport and protocol decisions are recorded in the
[architecture decision records](adr/), including the
[protocol-v2 decision](adr/0004-onboarding-protocol-v2.md), and in this
document. Current account/onboarding work belongs in the
[account experience record](ongoing-projects/web-client-account.md);
production transport operation and closure evidence belong in the
[mTLS runbook](runbooks/mtls-transport.md) and
[security/compliance record](SECURITY-COMPLIANCE.md). Reference repositories
under `EXAMPLES/` are research inputs only and are not runtime dependencies.
