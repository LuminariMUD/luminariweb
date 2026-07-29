# HTTP and WebSocket Contracts

## HTTP

### `GET /health`

Returns proxy health:

```json
{ "ok": true }
```

### `GET /api/settings`

Returns runtime app settings based on `shared/app-settings.ts`, including port
defaults, MUD presets, and personalization text. When local-destination
development is explicitly enabled, the response also prepends a
development-only `127.0.0.1` MUD preset using `LOCAL_MUD_PORT`.

Both HTTP endpoints are rate limited per IP. When the limit is exceeded, the server returns `429 Too Many Requests` with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers.

## WebSocket `/ws`

The browser opens a WebSocket connection to `/ws`. Message shapes are defined in `shared/mud.ts`.

`/ws` is an application protocol, not a raw Telnet bridge. The server expects
structured JSON browser messages and returns typed terminal, state, and
connection-status messages. A direct websockify or wsgate-style bridge cannot
serve this endpoint for the first-party React app because it forwards bytes
without validating the app message schema, negotiating MSDP for the app,
mapping state, or producing the documented status details.

The first-party `/ws` path is uncompressed browser WebSocket traffic carrying
application JSON messages. Telnet compression is not negotiated at the browser
application layer. MCCP remains rejected by the proxy, and GMCP remains
deferred until a source module contract, proxy parser, client mapping, and
fixtures exist. ADR 0002 records those boundaries.

Protocol feature support is tracked in the
[Protocol Feature Checklist](../protocol-feature-checklist.md). That checklist
documents which Telnet, terminal, MSDP, and deferred source protocols are
supported, partial, rejected, deferred, or still blocked by validation gaps. It
does not change the `/ws` contract: browser messages remain structured JSON and
server messages remain typed application messages, not raw Telnet bytes.

ADR 0003 keeps native Luminari-Source WebSocket support deferred. A future
source-native listener would be a separate transport decision until it proves a
typed browser contract, source descriptor lifecycle, parser behavior, security
controls, operations runbook, compatibility tests, and rollback. It is not a
replacement for this `/ws` contract today.

In public proxy mode, the server checks the `Origin` header before creating a proxy session. Local development origins are allowed by default. Production origins must be configured with `PROXY_ALLOWED_ORIGINS`. Missing or unexpected public-mode origins are closed before a MUD socket can be opened.

### Production Transport

The production browser contract remains same-origin WSS at
`https://web.luminarimud.com/ws`, but the active server-side transport is not a
direct TCP connection to public port `4100`:

```text
browser /ws
  -> Cloudflare Worker managed-mTLS WebSocket
  -> mud-origin.luminarimud.com:443/gateway/ws
  -> exact-name Apache client-certificate authorization
  -> 127.0.0.1:5191 Node gateway
  -> 127.0.0.1:4100 MUD
```

The Worker opens the fixed upstream WebSocket through the
`MUD_ORIGIN_MTLS` certificate binding. It does not complete the browser upgrade
until that upstream upgrade succeeds. Missing, invalid, expired, or revoked
credentials; hostname or chain errors; a non-WebSocket response; and origin
unavailability all fail closed with a generic browser error. Production has no
direct-TCP or plaintext retry.

Apache requires the dedicated Worker client certificate during the initial TLS
handshake and proxies only exact path `/gateway/ws`. The Node gateway is bound
to `127.0.0.1:5191` and its production socket factory can dial only
`127.0.0.1:4100`. The logical `luminarimud.com:4100` identity in browser
messages and `/api/settings` is validated for contract compatibility but
cannot select the physical destination.

The Worker relay preserves text and binary WebSocket frame type and leaves
Telnet, MSDP, onboarding, and terminal interpretation to the existing Node
`MudSession`. Local development and private operator-hosted Node deployments
retain their documented `node:net` behavior; the managed-mTLS route is the
production Worker boundary.

Public port `4100` remains a separate plaintext legacy-Telnet service. It is
not used as a Worker fallback. Deployment, rotation, revocation, monitoring,
and rollback procedures are in the
[mTLS transport runbook](../runbooks/mtls-transport.md).

### Browser to Server

Connect:

```json
{
  "type": "connect",
  "host": "krynn.d20mud.com",
  "port": 4300,
  "msdpVariables": {
    "characterName": "CHARACTER_NAME",
    "health": "HEALTH",
    "healthMax": "HEALTH_MAX",
    "room": "ROOM",
    "roomName": "ROOM_NAME",
    "roomExits": "ROOM_EXITS",
    "actions": "ACTIONS",
    "inventory": "INVENTORY",
    "minimap": "",
    "questInfo": ""
  }
}
```

Connect messages are validated asynchronously before `MudSession.connect()` opens a TCP socket. Public mode accepts curated preset `host:port` pairs and server-only `PROXY_ALLOWED_DESTINATIONS` additions. Arbitrary hostnames require explicit custom routing through `PROXY_PUBLIC_MODE=false` or `PROXY_ALLOW_CUSTOM_DESTINATIONS=true`.

Rejected connect attempts receive a `connection-status` message with `status: "error"` and a sanitized detail such as:

- `Provide a valid MUD host and port.`
- `This MUD destination is not allowed.`
- `Direct IP MUD destinations are not allowed in public mode.`
- `This MUD port is not allowed.`
- `This MUD destination could not be verified.`
- `This MUD destination resolves to a blocked network.`
- `A connection request is already in progress.`

Policy rejection details do not include raw DNS errors, socket errors, internal paths, or player command text.

Disconnect:

```json
{ "type": "disconnect" }
```

Send command input:

```json
{ "type": "input", "text": "look" }
```

Browser command input is throttled per WebSocket session. Excessive command bursts receive a connection-status error and are ignored until the rate window resets.

Update MSDP variable mapping:

```json
{
  "type": "msdp-config",
  "msdpVariables": {
    "room": "ROOM",
    "areaName": "AREA_NAME",
    "roomName": "ROOM_NAME",
    "roomVnum": "ROOM_VNUM",
    "roomExits": "ROOM_EXITS",
    "worldTime": "WORLD_TIME",
    "questInfo": ""
  }
}
```

Send an action offered by the latest structured onboarding state:

```json
{
  "type": "onboarding-action",
  "flowId": "connection-7f9c",
  "revision": 12,
  "action": "select",
  "choiceId": "human"
}
```

Text and password screens use the same message with `action: "submit"` and a
bounded `value` instead of `choiceId`. The proxy validates the flow identifier,
revision, offered action, and choice against its latest MUD-authored state. It
then sends the corresponding server-provided line through the existing MUD
input path. Password values are not added to history, aliases, triggers,
completion, persistence, or logs.

`classic-terminal` is a browser-local action and is not forwarded to the MUD.
Onboarding actions have a separate per-socket rate limit from ordinary command
input.

### Server to Browser

Connection status:

```json
{
  "type": "connection-status",
  "status": "connected",
  "detail": "Connected to krynn.d20mud.com:4300."
}
```

Timeout statuses use stable text:

```json
{
  "type": "connection-status",
  "status": "error",
  "detail": "Connection timed out before the MUD accepted the connection."
}
```

```json
{
  "type": "connection-status",
  "status": "disconnected",
  "detail": "Connection closed after being idle too long."
}
```

Terminal text:

```json
{
  "type": "terminal",
  "text": "Welcome..."
}
```

Partial MUD state update:

```json
{
  "type": "state",
  "state": {
    "health": 42,
    "healthMax": 50,
    "roomName": "Market Square",
    "areaName": "Luminari",
    "roomVnum": 1234,
    "roomExits": {
      "north": "1235",
      "south": "1233"
    },
    "actions": ["look", "rest"],
    "inventory": [
      {
        "name": "lantern",
        "quantity": 1
      }
    ]
  }
}
```

Structured onboarding state:

```json
{
  "type": "onboarding-state",
  "phase": "creating",
  "state": {
    "version": 1,
    "flowId": "connection-7f9c",
    "revision": 12,
    "mode": "character-creation",
    "screen": "race",
    "title": "Choose your race",
    "prompt": "Select a race to continue.",
    "sensitiveInput": false,
    "inputKind": "choice",
    "persistence": "draft",
    "choices": [
      {
        "id": "human",
        "label": "Human",
        "wireValue": "Human",
        "enabled": true,
        "mediaKey": "race/human"
      }
    ],
    "characters": [],
    "selection": {
      "name": "Aelarin"
    },
    "actions": ["select", "classic-terminal"],
    "sceneKey": "scene/race-gallery"
  }
}
```

The proxy emits this only after validating the MUD's bounded
`LUMINARI_ONBOARDING` MSDP payload. `phase` describes account or character
progress independently of the TCP connection status.

Malformed, oversized, unsupported, or disconnected onboarding state falls back
explicitly:

```json
{
  "type": "onboarding-fallback",
  "reason": "version-skew",
  "detail": "server onboarding protocol v2 is not supported"
}
```

Telnet ECHO negotiation and the structured state both contribute to the
sensitive-input signal. If either requires masking, the proxy emits:

```json
{
  "type": "sensitive-input",
  "sensitive": true
}
```

An invalid or stale action is not sent to the MUD:

```json
{
  "type": "onboarding-rejected",
  "code": "stale-revision",
  "detail": "the screen changed before you answered"
}
```

Blank MSDP mapping values disable requests for that client field. They are normalized and preserved in browser settings, but the proxy filters them out before sending MSDP `REPORT` or `SEND` requests.

The browser renders room, map, and quest panels from the resulting `state` messages. `ROOM`, `ROOM_EXITS`, and `MINIMAP` use explicit source-backed or fallback paths; `QUEST_INFO` remains override-only until the server emits a structured live value.

MSDP remains the supported first-party structured game-state path. GMCP helper
code in Luminari-Source is not exposed through `/ws` as a supported browser
contract.

The complete cross-repository onboarding boundary, compatibility matrix, and
deployment requirements are in
[Structured Account and Character Onboarding](../structured-onboarding.md).

## Validation

The server rejects invalid JSON, unknown message types, malformed connect
messages, invalid host strings, ports outside `1..65535`, banned service ports,
disallowed destinations, unsafe direct IP literals, unsafe DNS answers, and
unexpected public-mode origins. In ordinary Node mode, destination failures
are handled before `net.createConnection()` is called. In Cloudflare
production, logical-destination and origin failures are handled before the
fixed managed-mTLS upstream is opened, and the gateway's injected factory
cannot dial anything except the loopback MUD backend.

Bridge fallback services, if any, must use separate routes and separate client
expectations. They are not valid implementations of this `/ws` contract.
