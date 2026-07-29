# Structured Account and Character Onboarding

## Status

Protocol version 2 is live across Luminari Web and the paired production
Luminari-Source. It covers structured account login, the account lobby,
existing-character selection, core character creation, and the 14-item
role-play identity suite. Current builds always provide this complete
capability; it has no deployment or compile-time feature switch. Protocol v1
and the classic terminal remain compatibility and recovery paths for legacy or
malformed peers.

This is not an unrestricted production-readiness claim. Managed-mTLS
transport remediation is complete; manual accessibility/media review and
long-duration/load/CPU evidence remain outstanding. See the
[transport architecture](ARCHITECTURE.md#managed-mtls-origin-decision),
[operations runbook](runbooks/mtls-transport.md), and
[security/compliance record](SECURITY-COMPLIANCE.md).

## Runtime Boundary

```text
Browser
  |-- HTTPS application and versioned media
  |-- WSS /ws onboarding messages
  v
Cloudflare Worker (production)
  |-- fixed managed-mTLS WSS
  v
Exact-name Apache origin
  |-- exact /gateway/ws to loopback Node gateway
  v
Integrated Node protocol gateway
  |-- Telnet negotiation and MSDP validation
  |-- ordinary line input for accepted actions
  |-- fixed host-loopback connection in production
  v
Luminari-Source nanny() state machine
  |-- authoritative choices, restrictions, mutation, and save
  v
Existing account and character persistence
```

The three layers have deliberately separate responsibilities:

- Luminari-Source owns authentication, available choices, unlocks,
  restrictions, validation, mutation, and persistence.
- The Worker enforces browser admission and relays frames. The integrated Node
  gateway validates browser actions and the MUD's structured payload before
  forwarding either side.
- The browser owns presentation, responsive media, audio preferences,
  accessibility, and the decision to return to the classic terminal.

## Hosting Requirement

Local and operator-controlled Luminari Web deployments do **not** inherently
have to run on the same server as the MUD; their Node gateway needs a permitted
route to the MUD host and port. The supported first-party production topology
does co-locate the Node gateway and MUD and fixes their connection to host
loopback.

The media-rich experience does not add a shared-filesystem or media-serving
requirement to the MUD. Luminari-Source emits compact state and stable semantic
keys such as `race/human`. Images and audio are served by the web deployment
from `public/media/onboarding/<version>/`. Image or audio bytes are never sent
through Telnet, MSDP, or `/ws`.

Production protects the public Worker-to-origin hop with mutual TLS. Apache
requires the dedicated Worker certificate and current CRL before proxying the
fixed `/gateway/ws` path to a loopback Node gateway; that gateway always dials
the MUD on host loopback. Certificate, hostname, origin, or relay failures fail
closed without a direct TCP/TLS or plaintext retry. Cloudflare still handles
session plaintext in Worker memory, and public direct Telnet remains a
separate plaintext legacy service.

### Local/operator destination policy

The ordinary Node proxy's public mode rejects loopback and private-network
destinations. `PROXY_ALLOW_LOCAL_DESTINATIONS=true` is a developer-only opt-in:
it works only with `PROXY_PUBLIC_MODE=false` and is deliberately ignored in
public mode. These controls remain relevant to local/operator mode.

Production does not weaken that general policy. It uses a separate
fixed-loopback runtime that refuses non-loopback listeners and injects a socket
factory whose destination is not browser-selectable. Do not use the
development flag as a public workaround or turn an operator deployment into a
custom or open proxy.

## Paired MUD Requirement

The full cinematic flow appears only when the connected MUD and gateway
negotiate a supported onboarding protocol:

- The gateway always sends the v1 baseline
  `LUMINARI_ONBOARDING_VERSION=1` through MSDP.
- It then always sends `LUMINARI_ONBOARDING_VERSIONS=2,1`; the source selects
  the highest shared version.
- The MUD publishes `LUMINARI_ONBOARDING` as a bounded JSON string through
  MSDP.
- The proxy validates the payload, flow identifier, revision, actions, and
  size before it reaches React.
- Ordinary accepted actions use the exact line input understood and
  revalidated by `nanny()`. V2 private editor content uses a separate bounded,
  chunked, digested MSDP envelope and checked source persistence.

The paired implementation is in the Luminari-Source repository:

- `src/systems/web_client/onboarding.c`
- `src/systems/web_client/onboarding.h`
- `unittests/CuTest/test_web_onboarding.c`
- `docs/systems/WEB_ONBOARDING_SYSTEM.md`

Co-location does not make an older or unrelated MUD support the new
experience. Compatibility is capability-driven:

| Web client                       | MUD                       | Result                                                  |
| -------------------------------- | ------------------------- | ------------------------------------------------------- |
| Current                          | Current paired source     | Full structured onboarding and role-play identity suite |
| Current                          | Older v1-only source      | Core v1 structured flow; RP uses terminal fallback      |
| Current                          | Older or unrelated source | Classic terminal onboarding                             |
| Older or ordinary Telnet client  | Current paired source     | Existing text menus                                     |
| Current with a missing media key | Current paired source     | Structured flow with a generic media fallback           |

## Local Paired Development

In this workspace the companion checkout is `../Luminari-Source`. Build and run
it according to that repository's setup guide. Every normal source build
contains the RP suite. With that MUD listening on port `4100`, start Luminari
Web with:

```bash
PROXY_PUBLIC_MODE=false \
PROXY_ALLOW_LOCAL_DESTINATIONS=true \
LOCAL_MUD_PORT=4100 \
npm run dev
```

The proxy adds a development-only `127.0.0.1` MUD preset and makes it the
default. The opt-in still blocks metadata-service, link-local, multicast,
reserved, and unspecified destinations.

For an end-to-end UI test without the real MUD or database:

```bash
node scripts/synthetic-onboarding-mud.mjs 4444
```

Then, in another terminal:

```bash
PROXY_PUBLIC_MODE=false \
PROXY_ALLOW_LOCAL_DESTINATIONS=true \
LOCAL_MUD_PORT=4444 \
npm run dev
```

For design review without the Telnet proxy at all, run
`npm run dev:onboarding-preview` and `npm run dev:client`. The preview uses
invented data, performs no authentication, and must never be exposed publicly.

## Production Activation Evidence

Protocol v2 was initially activated on 2026-07-29. Its temporary rollout
switches were subsequently removed after a routine source rebuild silently
downgraded production to v1:

- Luminari Web originally activated the v2 advertisement at `main@72045c0`.
  Current gateways advertise `2,1` unconditionally.
- Luminari-Source originally activated a v2-compiled binary at
  `master@b49c4ffe` with SHA-256
  `fb554a3e7ccc63ac6f6c4ca57dfd275672815a29a77471200421eb15c4ad4a00`.
- Current source builds always include v2 and reject the retired compiler
  definition, so an ordinary configure/build cannot remove RP again.
- The permanent-availability releases are Luminari Web `main@4ff8f9c`, origin
  gateway release `4ff8f9cd`, and Luminari-Source `master@081618fa`. The
  running source binary SHA-256 is
  `3112236ccbfd4dab44fa9be7269071f1e2258aa849980d74a3776e9622225a35`.
- The correction passed web 338/338, Playwright 3/3, lint, formatting, build,
  and Cloudflare dry run; source 210/210 and focused parser 13/13 passed.
- Repeated live browser runs at 1440 x 1000 and 390 x 844 negotiated version 2,
  found all 14 RP cards/images, opened a real private editor, and returned and
  quit without console/page errors, warnings, or horizontal overflow.
- A fresh post-correction desktop run again found Role-play profile, 14 cards,
  14 loaded images, no broken images or horizontal overflow, and a working
  Background story cancel/return path.
- Exact v1 recovery was exercised after the first copyover exposed an allocator
  defect. The final v2 copyover followed three regression-tested memory-safety
  fixes and remained healthy beyond the earlier failure window.

## Production Checklist

- Deploy the integrated Luminari Web proxy; a blind WebSocket-to-TCP bridge
  cannot implement the `/ws` onboarding contract.
- Deploy a compatible Luminari-Source build and verify protocol version 2
  capability negotiation plus version-1/classic-terminal fallback.
- Serve the app and `/ws` over HTTPS/WSS, normally from one public browser
  origin.
- Set `PROXY_ALLOWED_ORIGINS` to the exact browser origin.
- Keep all browser-selectable MUD routes allowlisted and preserve DNS/IP,
  banned-port, quota, and timeout checks.
- Preserve the managed-mTLS Worker-to-origin route, exact-path Apache policy,
  loopback-only gateway/MUD connections, and fail-closed no-fallback behavior;
  operate it through the [mTLS runbook](runbooks/mtls-transport.md).
- Serve the versioned files under `public/media/onboarding/` with their paths
  intact; missing catalog art must continue to use generic fallbacks.
- Keep passwords, onboarding actions, character lists, commands, and terminal
  transcripts out of application, reverse-proxy, tunnel, and packet-capture
  logs.
- Probe `/health`, exercise account login and the complete RP flow, and drill
  the version-1/classic-terminal fallback around every rollout.
