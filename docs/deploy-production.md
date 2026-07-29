# Production Deployment: Cloudflare Free and Vercel Hobby Feasibility

> Research date: 2026-07-28
> Cloudflare production deployment: 2026-07-28
> Structured onboarding activation: 2026-07-28
> Role-play protocol-v2 activation: 2026-07-29
> Managed-mTLS transport activation: 2026-07-29
> Production URL: `https://web.luminarimud.com`
> Initial Worker version: `5371e1dd-518d-4ff2-a620-4f95a22f342a`
> Protocol-v2 Worker version: `7ebc397c-66b8-4697-9e77-08c21e3f55e7`
> Managed-mTLS activation Worker version: `e35c6199-4981-463b-b5f1-29ef5bb01885`
> Logical MUD target: `luminarimud.com:4100`
> Secure origin: `mud-origin.luminarimud.com:443/gateway/ws`
> Scope: determine whether Cloudflare Free or Vercel Hobby can host the
> Luminari Web frontend, onboarding media, HTTP endpoints, and
> WebSocket-to-Telnet proxy.

## Decision

Cloudflare Free now hosts the complete Luminari Web application at
`https://web.luminarimud.com`. The repository includes a Workers transport,
Workers Static Assets configuration, a fixed production destination policy,
same-origin WebSocket admission, and deployment scripts. The deployed Worker
opens a fixed outbound WebSocket through the managed `MUD_ORIGIN_MTLS`
certificate binding. Exact-name Apache validates the dedicated Worker
certificate, proxies only `/gateway/ws` to a loopback Node gateway, and that
gateway reaches the MUD only at `127.0.0.1:4100`.

This is an initial production deployment, not proof of every long-duration and
load acceptance gate. Two follow-ups remain open:

- Workers Static Assets returned full `200` audio responses to tested `Range`
  requests instead of `206`, so explicit seek behavior remains unproven even
  though complete audio files load with the correct MIME type;
- multi-hour sessions, concurrent load, and Free-plan CPU-percentile behavior
  still require an observation window.

Vercel Hobby can serve the frontend and now has the Node APIs required for the
WebSocket-to-Telnet bridge. Its current five-minute Function lifetime is
nevertheless a production blocker: Vercel explicitly closes a WebSocket when
its Function reaches that limit, which also destroys the associated MUD TCP
session. Vercel Hobby is therefore **not feasible as the sole production host**
for normal persistent MUD play. It is feasible as a static frontend in front of
an independently hosted long-lived proxy, provided the project qualifies for
Vercel's non-commercial Hobby plan.

The active production architecture is:

```text
Browser
  |-- HTTPS static assets and /api/settings
  |-- WSS /ws
  v
Cloudflare Worker + Workers Static Assets
  |-- fixed managed-mTLS WSS per player
  v
mud-origin.luminarimud.com:443/gateway/ws
  |-- exact-name Apache client-certificate authorization
  v
127.0.0.1:5191 Luminari Node gateway
  |-- fixed host-loopback Telnet
  v
127.0.0.1:4100 LuminariMUD
```

The Worker and static application do not run on the MUD host. The exact mTLS
origin, Apache, Node gateway, and MUD do share the production host at
`74.208.126.44`; all traffic after Apache authorization is loopback-only.
`mud-origin.luminarimud.com` is DNS-only so the managed client certificate
reaches the exact origin.

The Cloudflare deployment result by component is:

| Component                                           | Cloudflare Free result    | Evidence or boundary                                                                 |
| --------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------ |
| React application                                   | Deployed                  | Workers Static Assets serves the Vite output at the production origin                |
| Onboarding images and audio                         | Deployed; range gate open | 816 output files fit; representative audio returns correctly but not as `206`        |
| `GET /health` and `GET /api/settings`               | Deployed                  | Both return production JSON; settings advertise only the logical Luminari target     |
| Browser WebSocket endpoint at `/ws`                 | Deployed                  | `WebSocketPair` accepts the production browser and rejects foreign origins           |
| Managed-mTLS origin WebSocket                       | Deployed                  | The fixed binding authenticates to exact-name Apache; no direct-TCP fallback exists  |
| Loopback Node gateway                               | Deployed                  | Hardened systemd service listens at `127.0.0.1:5191` and dials only `127.0.0.1:4100` |
| Existing Express + `ws` implementation              | Reused                    | The origin gateway reuses `MudSession`; ordinary Node mode remains for development   |
| Browser-selected network destination                | Absent                    | Logical target is validated, but Worker and gateway physical routes are fixed        |
| Current cross-request in-memory connection counters | Best effort per isolate   | Strict per-session limits remain; per-IP Worker admission is not globally absolute   |
| Entire application on Cloudflare Pages only         | Not used                  | One Worker plus Static Assets owns the public same-origin application                |
| Entire Node server in Cloudflare Containers         | Not used and not Free     | The small persistent gateway runs beside the MUD, behind mTLS Apache                 |

The secure transport is therefore complete and deployed. The continuing
Free-plan capacity and long-session observation items are product-operations
work, not transport-confidentiality blockers.

The protocol-v2 role-play identity suite is also live. Repeated production
desktop/mobile walks negotiated v2, rendered all 14 source-authored RP options
and images, opened a real private editor, and returned cleanly to the account
flow. The web transport finding was remediated separately by the managed-mTLS
activation below. Long-duration/load/CPU, manual accessibility, and
media-approval work remain separate.

## What the Repository Requires

The repository supports two runtime paths:

- Cloudflare production builds the Vite client in `dist/client`, serves it with
  Workers Static Assets, and runs `worker/index.ts` for `/health`,
  `/api/settings`, and `/ws`.
- Local and operator-hosted fallback builds also produce `dist/server`;
  `npm start` launches the Express and `ws` Node server.
- The production Worker validates admission and relays application WebSocket
  frames through the fixed managed-mTLS binding.
- The loopback Node gateway runs the existing `MudSession`, negotiates
  Telnet/MSDP, validates structured onboarding, translates between MUD bytes
  and browser JSON, and dials only `127.0.0.1:4100`.
- The browser uses same-origin `/api/settings` and, unless `VITE_WS_URL` is
  supplied at build time, same-origin `/ws`.
- No application database or server-side account store is required.

Production is a single-destination service. The Worker must accept only:

```text
hostname: luminarimud.com
port:     4100
```

It rejects every other browser-supplied host or port. After validation, those
logical values cannot change the fixed managed-mTLS origin or fixed loopback
MUD backend.

## Static Asset Fit

The checked-in `public/` tree was measured as:

| Measurement             | Repository value | Cloudflare Free limit                         |
| ----------------------- | ---------------- | --------------------------------------------- |
| Files                   | 726              | 20,000 per deployment                         |
| Total bytes             | 93,226,255       | No smaller project-total limit was identified |
| Largest individual file | 3,601,414 bytes  | 25 MiB                                        |
| Files above 25 MiB      | 0                | 0 allowed                                     |

Vite adds the HTML, CSS, and JavaScript bundles to that corpus. The existing
margin is large enough that the final client build is expected to remain well
inside both limits, but deployment must measure `dist/client`, not rely on the
source-tree estimate.

Cloudflare documents 20,000 files and 25 MiB per asset on both Workers Static
Assets Free and Pages Free. Static asset requests served directly by Workers
Static Assets are free and unlimited. Cloudflare also supports byte-range
responses from cached complete objects, which is important for seeking within
the onboarding audio.

Sources:

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare cache range requests](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)
- [Pages limits](https://developers.cloudflare.com/pages/platform/limits/)

### Static-only deployment is not a production deployment

Cloudflare Pages or a scriptless Workers Static Assets project could publish the
UI and media immediately, but the result would not be a working MUD client:

- `/api/settings` would not return the runtime settings contract.
- `/ws` would not run the Luminari browser protocol.
- No process would open or parse the Telnet connection.
- Structured character creation would not receive authoritative MUD state.

Pages Functions use the Workers runtime and consume the Workers quota. Moving
the backend into a Pages Function would still require the same WebSocket,
managed-mTLS origin, and persistent Node gateway, so Pages does not remove the
core work.

## Workers Runtime Fit

### Capabilities that match

Workers provides the two unusual transports this application needs:

1. `WebSocketPair` can terminate the browser's WSS connection inside a Worker.
2. A managed-mTLS `Fetcher` binding can authenticate the Worker to the fixed
   origin and open the outbound WebSocket.

The paired WebSockets can stay open while the browser connection remains open.
Workers has no hard wall-clock limit for an HTTP-triggered invocation while
the client remains connected.

The managed binding presents the dedicated client certificate only in a
deployed Worker runtime. The exact origin is DNS-only, and
`global_fetch_strictly_public` permits the fixed public fetch without
introducing browser-selected routing.

Sources:

- [Workers WebSockets API](https://developers.cloudflare.com/workers/runtime-apis/websockets/)
- [Workers WebSocket example](https://developers.cloudflare.com/workers/examples/websockets/)
- [Workers mTLS certificate bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/mtls/)
- [Workers duration and connection limits](https://developers.cloudflare.com/workers/platform/limits/)

### Why the current server is not drop-in compatible

Cloudflare now supports parts of Node's HTTP server API and can run Express
with `httpServerHandler`. That does not make the current server deployable
unchanged:

- `server/index.ts` creates a real Node HTTP listener with `server.listen()`.
- `ws.WebSocketServer` depends on the Node HTTP `upgrade` event.
- Cloudflare's Node HTTP compatibility explicitly does not support the
  `upgrade` event or direct access to the underlying HTTP socket.
- Worker WebSocket servers use a Fetch handler, `WebSocketPair`, and a
  `101` response instead.
- `server/proxy-policy.ts` calls `node:dns/promises.lookup()`.
- Workers' `node:dns` documentation says `lookup()` is not implemented.
- `express.static()` and filesystem path resolution should be replaced by the
  Workers Static Assets binding.

Sources:

- [Workers Node HTTP compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/)
- [Workers Node DNS compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/)
- [Workers Node compatibility overview](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)

This is a transport-boundary port, not a frontend rewrite. Most shared protocol
types, validators, Telnet parsing, MSDP mapping, onboarding validation, and
browser components can remain platform-neutral.

## Free-Tier Capacity

The relevant Workers Free limits checked on the research date are:

| Limit                             | Workers Free value   | Luminari implication                                    |
| --------------------------------- | -------------------- | ------------------------------------------------------- |
| Dynamic Worker requests           | 100,000 per day      | Hard daily ceiling for API calls and WebSocket upgrades |
| CPU time                          | 10 ms per invocation | Must be profiled with relay/message bursts              |
| Memory                            | 128 MB per isolate   | Requires concurrent-session load testing                |
| Simultaneous outgoing connections | 6 per invocation     | One managed-mTLS origin WebSocket per player fits       |
| Worker bundle size                | 3 MB compressed      | Static media is separate; dry-run the code bundle       |
| Static asset files                | 20,000               | Current asset corpus fits                               |
| Individual static asset           | 25 MiB               | Current largest file fits                               |
| WebSocket message size            | 32 MiB               | App messages should be far smaller                      |
| Static asset requests             | Free and unlimited   | Keep assets off the Worker execution path               |

A normal first visit currently needs at least:

1. one dynamic request for `/api/settings`;
2. one dynamic request to upgrade `/ws`.

That gives a rough upper bound of 50,000 clean sessions per day before health
checks, reconnects, previews, or other Worker requests. It is a quota estimate,
not a capacity promise. WebSocket messages routed through a Worker do not count
as additional requests, but their code still consumes compute and must remain
within runtime limits.

Use selective asset routing so images, audio, CSS, and JavaScript do not invoke
the Worker. The Worker should run first only for `/health`, `/api/*`, and `/ws`.
When the daily request quota is exhausted, Cloudflare returns an error rather
than silently providing more free capacity.

The 10 ms CPU ceiling is the largest free-tier performance uncertainty. The
proxy does more than byte forwarding: it parses Telnet, decodes MSDP, validates
structured onboarding, maps state, and serializes browser messages. Local Node
benchmarks cannot prove it fits the Workers CPU model. A remote Workers
prototype must measure CPU time under login, character creation, room movement,
combat updates, and large terminal bursts.

## Session State and Rate Limits

Each player session can remain self-contained in the Worker invocation that
owns its browser WebSocket and MUD TCP socket. The current per-session command
and onboarding-action limiters can remain session-local.

The following process-global Node state cannot be treated as globally
authoritative in Workers:

- `httpRateLimiters`
- `websocketConnectionsByIp`
- any future module-level count of active players

Workers run across multiple isolates and locations. A module-level `Map` can be
useful as a local fast-path but cannot enforce a global per-IP limit.

The Free zone plan includes one WAF rate-limiting rule. It can protect the
initial `/ws` upgrade request by source IP, but Cloudflare's WAF evaluates the
initial HTTP `101` request only; it does not inspect later WebSocket messages.
Application-level command throttling must therefore remain in the session
handler.

Before production, choose and test one explicit concurrency policy:

- accept that connection concurrency is best-effort per isolate while keeping
  strict per-session command limits;
- add a small coordination Durable Object with expiring leases; or
- enforce connection admission outside the Worker with another operator-owned
  control.

Do not place the live TCP session itself in a Durable Object merely to count
connections. An outbound TCP socket prevents normal hibernation, consumes
duration allowance, and complicates recovery. Durable Objects are useful here
only if a narrowly scoped coordination design justifies them.

Sources:

- [Cloudflare WAF availability](https://developers.cloudflare.com/waf/)
- [Free-plan rate limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)

## Deployed Worker Design

The following configuration is implemented in `wrangler.jsonc` and
`worker/index.ts`.

### Routing

An illustrative `wrangler.jsonc` shape is:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "luminari-web",
  "main": "./worker/index.ts",
  "compatibility_date": "2026-07-28",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "mtls_certificates": [
    {
      "binding": "MUD_ORIGIN_MTLS",
      "certificate_id": "<current-managed-certificate-id>",
    },
  ],
  "assets": {
    "directory": "./dist/client",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/health", "/api/*", "/ws"],
  },
  "routes": [
    {
      "pattern": "web.luminarimud.com",
      "custom_domain": true,
    },
  ],
}
```

The actual certificate ID is tracked in `wrangler.jsonc` and
`ops/certificates/README.md`. Validate every change against the installed
Wrangler schema and dry-run before deployment.

Static assets should be served directly from the asset binding. The Worker
Fetch handler should own only:

- `GET /health`;
- `GET /api/settings`;
- the `/ws` WebSocket upgrade;
- an explicit `404` or `426` for invalid dynamic requests.

Cloudflare's SPA mode can return `index.html` for browser navigation routes
without invoking the Worker.

Sources:

- [Workers SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)
- [React and Vite on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)

### Fixed destination policy

The Worker must not become a general TCP proxy. On a browser `connect` message:

1. parse and validate the existing JSON contract;
2. require the normalized hostname to equal `luminarimud.com`;
3. require the port to equal `4100`;
4. reject every other destination before opening a socket;
5. open exactly one fixed managed-mTLS upstream WebSocket for the accepted
   session.

After validating the logical destination, the Worker ignores it for network
routing and calls the managed binding:

```ts
env.MUD_ORIGIN_MTLS.fetch(
  'https://mud-origin.luminarimud.com/gateway/ws',
  {
    headers: {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      Origin: 'https://mud-origin.luminarimud.com',
    },
  },
});
```

The browser upgrade is returned only after this fetch yields an upstream
WebSocket. Certificate, hostname, origin, connection, and upgrade failures
produce only a generic browser error and never retry public port `4100`.

`GET /api/settings` should advertise only the production LuminariMUD preset.
Leaving unrelated presets visible while rejecting them at the Worker would
create a misleading UI.

### Transport adapter

Port the server around interfaces rather than forking protocol behavior:

```text
BrowserTransport
  send(message)
  close(code, reason)
  onMessage(handler)
  onClose(handler)

MudTransport
  write(bytes)
  close()
  onData(handler)
  onClose(handler)
  onError(handler)
```

The Worker implementation uses `WebSocketPair` for the browser and the managed
mTLS `Fetcher` for the origin. The current Node implementation runs behind
Apache and continues to own the parser, MSDP mapper, onboarding validator,
message schemas, throttles, and MUD socket. Ordinary Node mode remains for
local development and tests.

This split keeps one Telnet/MSDP protocol implementation while giving the
Worker a supported authenticated origin transport.

### Client address

The Node implementation obtains an address from `request.socket.remoteAddress`.
A Worker has no equivalent Node request socket. Use the Worker request's
Cloudflare-provided client metadata for admission controls, and never trust a
browser-supplied forwarding header.

If the existing Node server is instead placed behind Cloudflare as a fallback,
it must be changed to trust `CF-Connecting-IP` only when the request is known to
have arrived through Cloudflare. Otherwise every tunneled connection may appear
to come from the local proxy and share one connection quota.

Cloudflare documents `CF-Connecting-IP` as the single client address it adds
between its edge and the origin.

Source:

- [Cloudflare HTTP request headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/)

## WebSocket Reliability

Cloudflare supports WebSockets on all plans. A WebSocket upgrade is counted as
one request, and subsequent messages do not count as HTTP requests.

Long-lived sessions are not immortal:

- Cloudflare may terminate WebSockets during network or runtime updates.
- Idle proxied WebSockets can be closed.
- Deploying a new Worker version can interrupt existing stateful sessions.
- A TCP or browser disconnect can occur without a graceful shutdown callback.

The client and Worker must treat disconnect as normal:

- use an application-level heartbeat or another tested keepalive mechanism;
- close the paired TCP socket whenever the browser closes;
- close the browser socket whenever the MUD closes;
- make cleanup idempotent;
- reconnect to a fresh MUD session rather than trying to reuse an orphaned
  socket;
- never replay a password or sensitive onboarding input automatically.

The current repository has no explicit browser/proxy heartbeat. Add one or
prove through an idle-session test that normal MUD traffic prevents the
Cloudflare idle path from closing valid players.

Sources:

- [Cloudflare proxied WebSockets](https://developers.cloudflare.com/network/websockets/)
- [Workers runtime updates and duration](https://developers.cloudflare.com/workers/platform/limits/)

## Security and Data Handling

### Fixed-target safety

The production Worker should not expose the current multi-MUD/custom-host
surface. A fixed `luminarimud.com:4100` constant provides a substantially
smaller egress and SSRF boundary.

Retain:

- exact browser-message validation;
- exact allowed `Origin`;
- one active MUD connection per browser session;
- connection and idle timeouts;
- command and onboarding-action throttles;
- bounded terminal dimensions and onboarding payloads;
- sanitized error messages;
- no command, password, account, character-list, or transcript logging.

### Authenticated production transport

The browser-to-Cloudflare leg is HTTPS/WSS. The Worker-to-host leg is WSS
through Cloudflare's managed mTLS certificate binding. Cloudflare validates the
public server chain and exact `mud-origin.luminarimud.com` hostname; Apache
requires the dedicated Worker client certificate and current CRL before it
proxies the fixed path.

Apache-to-Node and Node-to-MUD traffic is restricted to host loopback. The
production Worker contains no direct TCP or plaintext fallback. This remediates
`ONBOARD-SEC-001` for web sessions while preserving the tested Telnet/MSDP
bytes inside the authenticated route.

Public port `4100` remains ordinary Telnet for legacy direct clients. That
separate path remains plaintext and is documented as such; the web Worker
never uses it as a fallback. See
[`SECURITY-COMPLIANCE.md`](SECURITY-COMPLIANCE.md) and the
[mTLS transport runbook](runbooks/mtls-transport.md).

### Cloudflare data boundary

Cloudflare will terminate browser TLS and execute code that temporarily sees
login and gameplay messages. The Worker must keep this data in memory only and
must not write it to logs, analytics payloads, KV, D1, Durable Object storage,
or traces. The operator should include Cloudflare in its infrastructure and
privacy review before rollout.

## Alternative Cloudflare Topologies

### Cloudflare Tunnel in front of the current Node app

Cloudflare Tunnel is available on all plans and can publish a local HTTP service
without opening an inbound origin port. It supports the HTTPS/WSS path to the
existing integrated Node server.

```text
Browser -> Cloudflare -> Tunnel -> current Node app -> luminarimud.com:4100
```

This is the lowest-code Cloudflare integration, but Cloudflare is the edge and
tunnel provider rather than the compute host. A machine must still run Node,
PM2 or another supervisor, and `cloudflared`.

Required code work still includes:

- restore the real client address from a trusted Cloudflare header;
- add or validate WebSocket keepalive behavior;
- ensure only the production MUD is advertised and accepted;
- retain process supervision, health monitoring, and outbound firewall policy.

Use this topology if the Worker port is not ready and suitable origin compute
already exists.

Sources:

- [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/)
- [Tunnel public hostname routing](https://developers.cloudflare.com/tunnel/routing/)

### Cloudflare Pages

Pages is suitable for a static preview only. Adding Pages Functions turns the
dynamic part back into a Workers implementation and uses the Workers quota.
There is no production advantage over a single Worker with Static Assets for
this same-origin application.

### Cloudflare Containers

Containers could run a conventional Node process more directly, but Cloudflare
documents Containers as available on Workers Paid only. They do not satisfy the
Free-tier objective.

Source:

- [Cloudflare Containers](https://developers.cloudflare.com/containers/)

### Cloudflare Spectrum

Spectrum is a Layer 4 proxy, not an application host, and is available only on
paid plans. It does not replace the Luminari `/ws` JSON protocol or the
Telnet/MSDP parser.

Source:

- [Cloudflare Spectrum availability](https://developers.cloudflare.com/spectrum/get-started/)

## Vercel Hobby Feasibility

Vercel's WebSocket support changed shortly before this review. The current
official WebSocket documentation, last updated July 6, 2026, says Vercel
Functions can accept WebSocket connections, pins each connection to the
Function instance that accepted it, and specifically demonstrates Node
`http`, Express, and the `ws` package. Older articles saying Vercel Functions
cannot act as WebSocket servers no longer describe the documented platform.

The technically possible topology is:

```text
Browser
  |-- HTTPS static assets and /api/settings
  |-- WSS /ws
  v
Vercel CDN + Node.js Vercel Function
  |-- one fixed outbound TCP connection per player
  v
luminarimud.com:4100
```

The MUD still does not need to run on the same server. The Vercel Function
would make a normal public outbound TCP connection to
`luminarimud.com:4100`.

Sources:

- [Vercel Functions WebSockets](https://vercel.com/docs/functions/websockets)
- [Vercel Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js)
- [Vercel Functions limits](https://vercel.com/docs/functions/limitations)

### Component fit

| Component                                            | Vercel Hobby result          | Reason                                                                                     |
| ---------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| React application                                    | Pass                         | Vercel can build Vite and serve the static output from its CDN                             |
| Onboarding images and audio                          | Pass, with narrow CLI margin | Current output fits, but the repository is close to Hobby's 100 MB CLI source-upload limit |
| `GET /health` and `GET /api/settings`                | Pass with port               | Small Node Function routes can replace or adapt the Express routes                         |
| Browser WebSocket endpoint at `/ws`                  | Pass with port               | Current Vercel Functions explicitly support Node `http`, Express, and `ws`                 |
| Outbound TCP to `luminarimud.com:4100`               | Pass with port               | The Node runtime has full Node API coverage, including network/TCP sockets                 |
| Current Telnet parser, MSDP mapper, and `MudSession` | Mostly reusable              | Buffer, `node:net`, and other Node APIs remain available                                   |
| Existing server unchanged                            | Fail                         | A Vercel entrypoint must export the server instead of calling `listen()`                   |
| Process-global IP and connection counters            | Needs redesign               | Function instances do not share a globally authoritative module-level `Map`                |
| MUD sessions longer than five minutes                | Fail                         | Hobby terminates the Function and its WebSocket at 300 seconds                             |
| Complete production MUD client on Hobby              | Fail                         | Forced five-minute TCP session loss is incompatible with normal persistent play            |

### Smaller code port than Workers

The Vercel port is materially smaller than the Cloudflare Workers port:

- Vercel's current WebSocket example uses `http.createServer()` and
  `WebSocketServer`, the same basic boundary as this repository.
- Vercel documents full Node.js API coverage, so `net.createConnection()` in
  `MudSession` can remain the outbound TCP mechanism.
- `node:dns/promises.lookup()` can remain available, although a fixed
  `luminarimud.com:4100` production policy should still replace the
  general-purpose destination surface.
- The shared parser, MSDP mapping, onboarding validator, browser message
  schemas, and most of `server/index.ts` can remain Node code.

Required changes would include exporting an HTTP server from a Vercel Function
entrypoint, removing the top-level `server.listen()`, separating static routing
from the Function, routing `/ws` to that Function, and making cleanup safe when
the Function is terminated. The distributed process-global counter problem
remains; one reused instance's `Map` cannot enforce an account-wide or
location-wide connection limit.

Vercel WebSockets require Fluid compute. It is enabled by default for new
projects created on or after April 23, 2025, but must be checked explicitly on
an older project.

### The five-minute lifetime is a hard production blocker

Vercel Hobby's current Fluid compute maximum is 300 seconds. Vercel's WebSocket
documentation explicitly says the connection closes when the Function reaches
that maximum duration.

For this application, that is not merely a momentary browser reconnect:

1. the WebSocket owns one live `MudSession`;
2. the `MudSession` owns one authenticated Telnet TCP socket;
3. Function termination closes both transports;
4. a reconnect reaches a new Function and creates a new TCP socket;
5. the player must establish a new MUD login/session.

Redis or another external state store can preserve counters, presence, or
application data, but it cannot preserve or transfer the live authenticated
TCP socket to a new Function. The current client also correctly avoids
persisting or automatically replaying passwords. Transparent five-minute
session rotation would require a resumable session mechanism in LuminariMUD or
a separate long-lived gateway outside Vercel; neither exists in this
repository.

Even Vercel Pro's 800-second general maximum and 1,800-second beta maximum
would still force disconnects during ordinary extended MUD play. Vercel
Services and container-based Functions follow Function duration limits, so
packaging the server differently does not make the session persistent.

Sources:

- [Vercel WebSocket disconnections](https://vercel.com/docs/functions/websockets#handle-disconnections-and-reconnects)
- [Vercel maximum Function duration](https://vercel.com/docs/functions/limitations#max-duration)
- [Vercel Services](https://vercel.com/docs/services)

### Static assets and free quotas

The checked-in `public/` tree and existing local Vite output snapshot were
measured on the research date:

| Measurement or quota         | Repository / Hobby value | Implication                                                                                  |
| ---------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| Checked-in `public/` files   | 726                      | Well below Vercel's 15,000 source-file deployment limit                                      |
| Checked-in `public/` bytes   | 93,226,255               | Media alone consumes most of the 100 MB Hobby CLI source-upload allowance                    |
| Existing `dist/client` files | 729                      | Output file count is small                                                                   |
| Existing `dist/client` bytes | 94,229,277               | Static output itself is modest, but this is not a fresh clean-build measurement              |
| Largest static file          | 3,601,414 bytes          | No large individual asset problem was identified                                             |
| Tracked repository bytes     | 94,929,470               | A CLI source upload has only about 5.1 MB of margin before other included or generated files |
| Fast Data Transfer           | 100 GB per month         | Static files and WebSocket traffic to visitors consume a finite monthly transfer allowance   |
| Fast Origin Transfer         | Up to 10 GB per month    | Function/WebSocket traffic between the CDN and Function consumes this allowance              |
| Function invocations         | 1,000,000 per month      | Every WebSocket reconnect is another invocation                                              |
| Active CPU                   | 4 CPU-hours per month    | More generous per burst than Workers' 10 ms ceiling, but finite monthly compute              |
| Provisioned memory           | 360 GB-hours per month   | Open WebSockets consume Function usage while connected                                       |
| Function memory              | 2 GB / 1 vCPU            | Fixed on Hobby                                                                               |
| Function/WebSocket duration  | 300 seconds              | Decisive session-continuity failure                                                          |
| Runtime log retention        | 1 hour                   | Weak evidence window for production incident response                                        |

The 100 MB limit is specifically documented for CLI source uploads, not as a
100 MB CDN output cap. This repository currently fits only narrowly. A Vercel
deployment should exclude `docs/`, tests, raw media sources, local examples,
and other non-runtime files with `.vercelignore`, then verify the actual upload
and generated output. Git-based deployment may avoid the CLI upload path, but
it does not remove the need to keep deployment inputs intentional.

Cached static delivery still counts as Fast Data Transfer. In contrast,
Cloudflare documents Workers Static Assets requests as free and unlimited.
Vercel also meters Function usage while a WebSocket is active. At Hobby's fixed
2 GB Function size, 360 GB-hours represents 180 fully occupied
two-gigabyte-instance hours per month. Fluid compute can place multiple
connections on one instance, so that is not a direct player-hour limit; a load
test is needed to determine actual multiplexing and quota consumption.

Sources:

- [Vercel platform limits](https://vercel.com/docs/limits)
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
- [Vercel CDN usage](https://vercel.com/docs/manage-cdn-usage)
- [Vercel Function usage and pricing](https://vercel.com/docs/functions/usage-and-pricing)

### Hobby plan eligibility

Vercel restricts Hobby to non-commercial personal use. Its current fair-use
definition treats financial gain by anyone involved in any part of production
as commercial and specifically says asking for donations counts as commercial
usage.

The operator must confirm that the official Luminari Web deployment qualifies.
If the site requests donations, includes advertising, supports a paid service,
or involves compensated production under Vercel's definition, Hobby is not an
available production option regardless of technical traffic levels.

Cloudflare's Free-plan analysis in this document does not have the same
personal/non-commercial eligibility condition.

Source:

- [Vercel fair-use guidelines](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)

### Feasible Vercel hybrid

Vercel Hobby can host only the frontend and onboarding media while an external
long-lived Node service hosts `/ws`:

```text
Browser
  |-- HTTPS assets -> Vercel Hobby
  |-- WSS /ws     -> external Node proxy -> luminarimud.com:4100
```

This requires an operator-controlled proxy hostname, TLS, an exact allowed
browser `Origin`, and a production `VITE_WS_URL` pointing to it. The external
proxy can run anywhere that can accept WSS and reach the public
`luminarimud.com:4100`; it does not need to share the MUD server.

This topology is operationally feasible, but it is not a complete Vercel
deployment and it does not eliminate the cost or maintenance of persistent
compute. It is comparable to serving the frontend at one provider while
retaining the current Node proxy elsewhere.

## Cloudflare Free vs. Vercel Hobby

| Decision factor                     | Cloudflare Free                                                | Vercel Hobby                                                        |
| ----------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| Static React/media hosting          | Pass; 20,000 files, 25 MiB each                                | Pass; current corpus fits, but CLI source upload is close to 100 MB |
| Static delivery allowance           | Static Asset requests documented as free and unlimited         | 100 GB Fast Data Transfer per month                                 |
| Browser WebSocket server            | Supported through `WebSocketPair`                              | Supported through Node `http`, Express, and `ws`                    |
| Secure persistent MUD route         | Deployed through managed mTLS plus loopback Node gateway       | TLS origin and persistent external compute still required           |
| Reuse of current Node server        | High; `MudSession` runs in the loopback origin gateway         | High; export server and adapt routing/lifecycle                     |
| Maximum connected-session wall time | No hard request wall-time while the client remains connected   | 300 seconds; WebSocket then closes                                  |
| Primary free compute risk           | 10 ms CPU ceiling during protocol bursts                       | Forced five-minute session loss; monthly memory/CPU consumption     |
| Dynamic request allowance           | 100,000 per day                                                | 1,000,000 Function invocations per month                            |
| Shared process-global counters      | Not globally authoritative                                     | Not globally authoritative                                          |
| Plan eligibility                    | No personal/non-commercial condition identified in this review | Non-commercial personal use only                                    |
| Complete production host verdict    | **Deployed; capacity observation continues**                   | **Not feasible for persistent MUD sessions**                        |
| Static frontend plus external proxy | Feasible, but external compute remains                         | Feasible, but external compute remains                              |

Vercel is the easier code port, but Cloudflare is the stronger Free-tier
candidate for the complete application because it does not impose a
five-minute lifetime on the live browser-to-MUD bridge. The deployed
Cloudflare relay still requires ongoing CPU and capacity observation; Vercel's
five-minute disconnect is already a documented contradiction of the required
multi-hour session behavior.

## Cloudflare Implementation Result

The production implementation now includes:

1. pinned Wrangler and Worker types;
2. one Worker plus Static Assets for `/health`, `/api/settings`, and `/ws`;
3. fixed logical destination validation;
4. `WebSocketPair` browser admission;
5. a fixed managed-mTLS origin `Fetcher`;
6. an exact-name, exact-path Apache client-authentication boundary;
7. a hardened loopback Node gateway that reuses `MudSession`;
8. fixed `127.0.0.1:4100` MUD egress;
9. relay lifecycle, protocol-skew, real-mTLS, and browser tests;
10. dry-run bundle and binding checks;
11. content-free health, expiry, CRL, and handshake monitoring; and
12. deployment, rollback, rotation, revocation, and incident runbooks.

The ordinary Node server remains the local test harness. The production Node
gateway is not a plaintext public rollback route; it is the protocol endpoint
behind authenticated Apache.

## Cloudflare Production Acceptance Gates

Cloudflare Free should be approved as the production host only when every gate
below has evidence.

### Initial deployment evidence

The 2026-07-28 deployment established the following baseline:

| Check                              | Result                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| Worker version                     | `5371e1dd-518d-4ff2-a620-4f95a22f342a`                                             |
| Static assets                      | 816 files read; 729 uploaded on the first deployment                               |
| Worker bundle                      | 64.28 KiB uncompressed / 13.68 KiB gzip; 16 ms startup                             |
| Repository gates                   | Format, lint, 220 tests, TypeScript, Vite build, dry-run, and npm audit passed     |
| HTTP                               | Production `/health`, `/api/settings`, HTML, and representative media returned 200 |
| Destination policy                 | A foreign origin received 403; a non-Luminari target was rejected before TCP       |
| Live transport                     | Production WSS connected to the MUD and received terminal plus MSDP state          |
| Browser QA                         | Chromium desktop and mobile passed with no app console/page/network errors         |
| Structured onboarding              | Activated and browser-verified on desktop and mobile                               |
| Audio byte ranges                  | Open: tested range request returned full 200 rather than partial 206               |
| Long-duration, load, and CPU gates | Open                                                                               |

### Structured onboarding activation evidence

The production MUD checkout was already on Luminari-Source commit
`cca182663796259e34b1d0fa3776f14ed794cd2a`, but the port `4100` process was
still executing the prior, deleted binary. A player-preserving copyover on
2026-07-28 activated the installed protocol-v1 binary:

| Check                 | Result                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------- |
| Running binary before | `5a4ffc5a46ac769beb4b90db3ac4579b0e78a056f23e39099b5b51fef7e5b18c`                       |
| Running binary after  | `e51f03a2aaa54b5342d8d9bf6ca6081a6c23a4088f8e5c4a95b8867e948d50eb`                       |
| Player preservation   | All four playing descriptors were restored; the listener and process PID were retained   |
| Copyover recovery     | The copyover state file cleared and supervisor PID/state files returned to healthy state |
| Desktop browser QA    | Chromium at 1440 by 1000 rendered the account-name scene, card art, and sound controls   |
| Mobile browser QA     | Chromium at 390 by 844 rendered the responsive confirmation scene without overflow       |
| Media and audio       | Responsive AVIF/WebP art plus music, ambience, and SFX returned HTTP 200                 |
| Interaction           | Account name to confirmation to retype and the sound-settings panel were exercised       |
| Runtime health        | No relevant console errors, page errors, failed requests, or missing rendered images     |

### Protocol-v2 role-play activation evidence

The operator authorized the complete RP rollout on 2026-07-29, but the
still-open `ONBOARD-SEC-001` plain-Telnet risk had not been explicitly
surfaced. The activation is therefore not recorded as informed risk
acceptance. The risk was subsequently remediated that day; see the
[managed-mTLS activation evidence](#managed-mtls-transport-activation-evidence)
and [security closure record](SECURITY-COMPLIANCE.md#onboard-sec-001-closure-evidence).

| Check                           | Result                                                                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web release                     | `luminariweb main@72045c0`; Worker version `7ebc397c-66b8-4697-9e77-08c21e3f55e7`; the temporary rollout switch was enabled at this activation     |
| Source release                  | `Luminari-Source master@b49c4ffe`; running/installed SHA-256 `fb554a3e7ccc63ac6f6c4ca57dfd275672815a29a77471200421eb15c4ad4a00`                    |
| Exact v1 recovery               | SHA-256 `c23d6f878fd629106b0e1003e4349c017b327d22cebc8f3b9f2df7e66298d86a` retained in dated production rollback artifacts                         |
| Build and automated tests       | Web 320/320, lint, format, and build pass; source v2 release 207/207; source v2 AddressSanitizer 207/207; required install completed               |
| Sanitized source-backed browser | Five complete RP hub/background-editor cycles passed through the real web gateway and sanitized MUD without an AddressSanitizer report             |
| Live desktop QA                 | Repeated 1440 x 1000 runs negotiated authoritative v2, found 14 cards/14 loaded images, opened Background story, returned, and quit                |
| Live mobile QA                  | Repeated 390 x 844 runs passed the same checks with no horizontal overflow                                                                         |
| Browser diagnostics             | No console errors, page errors, or warnings                                                                                                        |
| Copyover health                 | Final player-preserving copyover retained PID `1318258` and listener `4100`; copyover state cleared                                                |
| Runtime observation             | Healthy beyond the earlier failure window with no allocator, invalid-chunk, corruption, sanitizer, abort, SIGSEGV/SIGABRT, or exit-134/139 markers |

The first v2 copyover was not accepted as success: it terminated with
`malloc_consolidate(): invalid chunk size`, and the exact v1 binary was
restored. Investigation found and fixed three independent memory-safety
defects before the final rollout:

1. `sort_backgrounds()` passed one sentinel too many to `qsort()`.
2. `eval_op()` decremented pointers before empty operand buffers while trimming
   whitespace.
3. `move_on_path()` indexed direction/exit arrays before handling a negative
   BFS sentinel.

Each defect has a regression test in `master@b49c4ffe`. The source was then
clean-built, tested, installed, copied over again, and observed beyond the
prior crash window. This short observation is not a substitute for the open
multi-hour/load gate.

### Permanent role-play availability correction

A routine source update later on 2026-07-29 ran `./configure` without the
temporary v2 compiler definition. The build succeeded and silently installed a
v1-only binary while the gateway continued offering v2. Both services remained
healthy, but fresh sessions negotiated v1 and the structured RP profile
disappeared.

The rollout switches were removed from both repositories. Current gateways
always advertise `2,1`; current source builds always include v2. The source
header rejects any attempted definition of the retired compiler switch, and
the default source test suite asserts that v2 negotiates successfully. Version
negotiation remains only for old-peer and ordinary-Telnet compatibility.

| Check                        | Result                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web correction               | `luminariweb main@4ff8f9c`; origin gateway release `/opt/luminari-web-gateway/releases/4ff8f9cd`                                                              |
| Source correction            | `Luminari-Source master@081618fa`; running/installed SHA-256 `3112236ccbfd4dab44fa9be7269071f1e2258aa849980d74a3776e9622225a35`                               |
| Gateway kill-switch removal  | The runtime option, environment parsing, service binding, helper, and toggle tests were deleted; the live process environment contains no retired v2 variable |
| Source kill-switch removal   | Default builds select protocol 2; defining the retired macro as either `0` or `1` is a compile error                                                          |
| Automated gates              | Web 338/338, lint, format, build, Cloudflare dry run, and Playwright 3/3 passed; source 210/210 plus focused protocol parser 13/13 passed                     |
| Gateway activation           | New release started with zero active gateway sessions, returned healthy, and reported zero restarts                                                           |
| Player-preserving activation | Copyover retained PID `1619422` and all five established sockets: four existing direct sockets and the QA loopback socket                                     |
| Copyover recovery            | Running and installed hashes match; `copyover.dat` cleared; service remained active; no recent allocator, signal, core-dump, or exit-134/139 marker appeared  |
| Live RP verification         | A fresh production session exposed Role-play profile, all 14 cards and 14 loaded images, opened and cancelled Background story, and returned cleanly          |
| Layout and media             | Zero broken RP images and no desktop horizontal overflow                                                                                                      |
| Source rollback artifact     | `bin/circle.pre-permanent-rp-20260729T141451Z`, SHA-256 `1e1cdea719a593d24c92df0bc8a1594a0f0a8b05e9f52bbc2769a58a1ff64167`                                    |
| Gateway rollback artifacts   | Prior release `e8c8600` and dated pre-correction systemd unit retained                                                                                        |

Cloudflare Worker version `773288a8-cb00-4e05-bb24-c0da37c5c1ee` remained at
100 percent because the Worker is only the managed-mTLS relay and neither its
code nor the static client changed in this correction. The changed
`MudSession` runtime was activated at the versioned origin gateway, avoiding an
unnecessary Worker WebSocket drain.

### Managed-mTLS transport activation evidence

The production Worker was promoted from the direct plaintext port-`4100` route
to the managed-mTLS origin route on 2026-07-29:

| Check                    | Result                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pre-cutover Worker       | `7ebc397c-66b8-4697-9e77-08c21e3f55e7` at 100%; retained only as an explicit security-rollback version                                                                         |
| Secure activation Worker | `e35c6199-4981-463b-b5f1-29ef5bb01885` promoted to 100% at cutover on both the custom domain and Workers service; later secure versions may supersede it                       |
| Managed client identity  | Certificate ID `6015b318-1e10-4584-aa26-6673afd1e5d4`, serial `1001`, valid through 2026-10-27 10:36:17 UTC                                                                    |
| Origin authorization     | Exact-name Apache requires the client certificate in the initial handshake and proxies only `/gateway/ws`                                                                      |
| Gateway                  | Release `e8c8600`, hardened systemd service at `127.0.0.1:5191`, fixed backend `127.0.0.1:4100`, zero restarts at cutover                                                      |
| MUD                      | Tested v2 binary SHA-256 `0559725325cfbd3ca9fc8ac749b37a2f87d9f064e7005cd9525226b42a579e00` listening on `4100`                                                                |
| Certificate rotation     | Successor `b` worked during overlap; predecessor serial `1000` was revoked, rejected with zero application bytes, and deleted from Cloudflare                                  |
| Negative transport       | Missing/untrusted/revoked clients, wrong hostname, TLS 1.1, and raw Telnet were rejected without backend application bytes                                                     |
| Browser QA               | Invented-data v2 login, 14-entry RP hub, exact private save/reload, desktop, `390 x 844`, `360 x 740`, terminal `look`, and graceful `quit` passed with no console/page errors |
| Production socket path   | Active browser produced one Apache-to-gateway socket and one gateway-to-loopback-MUD socket; closing it drained both to zero                                                   |
| Pre-cutover drain        | A controlled plaintext web session was disconnected by promotion; no pre-cutover Worker session remained                                                                       |
| Legacy Telnet            | Two observed direct Telnet sessions were intentionally left untouched and remain a separately documented plaintext service                                                     |
| Public capture           | 1,439 packets / 496,115 bytes, SHA-256 `06cb38e665795d47ce91389ec87d81be4ab04046a4a9be327e314768dba36e59`; the exact invented production RP marker was absent                  |

The production capture is retained only as mode-`0600`, root-owned evidence at
`/var/lib/luminari-mtls/evidence/production-worker-origin-20260729T111004Z.pcap`.
An earlier route-free canary capture covered invented account, password,
command, and RP markers; neither capture is stored in Git.

The parallel stunnel listener on `54443` is intentionally retained for
independent certificate, revocation, TLS-version, and raw-Telnet negative
probes. It is not in the player route.

The route-free `luminari-web-mtls-runtime-canary` was deleted after production
promotion, session drain, and observation. The versioned production deployment
remains the rollback and audit surface.

### Build and artifact

- `npm ci` succeeds from a clean checkout.
- `npm run lint`, `npm test`, and `npm run build` all pass.
- `find dist/client -type f | wc -l` is below 20,000.
- No `dist/client` file exceeds 25 MiB.
- `wrangler deploy --dry-run` reports a compressed Worker below 3 MB.
- Static requests do not invoke Worker code.

### HTTP and assets

- `/health` returns HTTP 200 with `{ "ok": true }`.
- `/api/settings` advertises only `luminarimud.com:4100`.
- SPA navigation returns `index.html`.
- Versioned images, AVIF/WebP fallbacks, music, ambience, and SFX load.
- Audio byte-range requests return valid `206` responses and seeking works.
- The service worker never caches API, WebSocket, or sensitive session data.

### WebSocket and MUD protocol

- The deployed origin accepts WSS at `/ws`.
- Missing and foreign `Origin` values are rejected.
- The Worker opens only the fixed `MUD_ORIGIN_MTLS` WebSocket; it never opens
  public port `4100`.
- Exact-name Apache validates the dedicated Worker certificate and proxies only
  `/gateway/ws`.
- The Node gateway reaches `127.0.0.1:4100` only from host loopback.
- Every other hostname and port is rejected before an outbound socket opens.
- TTYPE, NAWS, MSDP, terminal text, resizing, disconnect, and timeout behavior
  match the Node implementation.
- Structured onboarding version 2 completes account login, character creation,
  and the role-play identity suite with the expected media.
- Version-1 peers and unsupported onboarding states retain the classic-terminal
  fallback.
- Password and sensitive-input behavior matches the existing contract.

### Reliability and limits

- An idle session survives the intended production idle period.
- A multi-hour active session remains usable.
- Browser close always closes the MUD TCP socket.
- MUD close always closes or updates the browser session.
- A Worker deployment or forced disconnect produces a safe reconnect path.
- Concurrent-session tests stay within the 128 MB isolate limit.
- Login, onboarding, movement, combat, and terminal bursts remain within the
  10 ms CPU ceiling at an agreed percentile.
- Forecast daily API calls and WebSocket upgrades remain below 100,000 with
  headroom for reconnects and monitoring.
- The selected per-IP admission policy works across more than one Worker
  isolate and location, or its best-effort limitation is explicitly accepted.

### Security and operations

- Player content and credentials do not appear in Worker logs or analytics.
- The fixed destination cannot be overridden from the browser.
- The Worker-to-host route is TLS 1.2 or newer with server-hostname and client
  certificate authentication.
- Certificate/hostname/origin failures fail closed without a plaintext retry.
- Public direct Telnet remains a separately documented plaintext legacy
  service.
- WAF and application rate limits are tested separately.
- Quota exhaustion fails closed and has an alert/runbook.
- Secure rollback, plaintext security rollback, certificate rotation,
  revocation, renewal, capture, and incident response are documented in
  [the mTLS runbook](runbooks/mtls-transport.md).

## Cloudflare Deployment and Rollback Outline

For a production deployment:

```bash
npm ci
npm run lint
npm test
npm run cloudflare:dry-run
npm run cloudflare:deploy
```

The checked-in `wrangler.jsonc` deploys both the Workers preview URL and the
`web.luminarimud.com` custom domain. After every deployment, test real browser
WSS, the managed-mTLS origin upgrade, the loopback gateway/MUD socket pair, and
the absence of any new Worker/public peer on port `4100`.

For rollback:

1. retain the last known-good secure Worker version;
2. retain the current loopback gateway release;
3. roll back securely if health, WSS admission, mTLS origin, onboarding, CPU,
   memory, or quota checks regress;
4. keep web login fail closed if no secure version works;
5. treat the pre-mTLS Worker as an explicit, informed security rollback that
   reopens the High finding;
6. verify a fresh invented-data session and socket topology after rollback;
7. never preserve or replay live passwords across versions.

Cloudflare supports versioned Worker deployments, but the rollback procedure
must be rehearsed with this app's long-lived WebSocket behavior rather than
assuming an HTTP-only rollback is sufficient. The authoritative commands and
certificate procedures are in the
[mTLS transport runbook](runbooks/mtls-transport.md).

## Final Feasibility Verdict

Cloudflare Free now hosts the complete Luminari Web application for the fixed
logical `luminarimud.com:4100` target through an authenticated origin gateway:

- the frontend and media fit the static limits;
- same-origin HTTP endpoints fit Workers;
- Workers supports browser WebSockets;
- Workers supports the deployed managed-mTLS origin WebSocket;
- exact-name Apache and a loopback Node gateway keep production web traffic
  off public Telnet;
- static asset requests are free and unlimited;
- the expected dynamic request volume may fit the 100,000/day allowance.

The transport relay is implemented and the production deployment checks pass.
Cloudflare Workers with Static Assets is the selected production host.
Approval for an extended production observation window remains conditional on
the open range, CPU, load, and long-session gates above. Cloudflare Tunnel in
front of the current Node process remains the rollback topology when external
compute is available.

Vercel Hobby can build and serve the frontend/media and, as of the July 2026
Vercel WebSocket documentation, can technically run the existing style of
Node/Express/`ws` proxy with outbound `node:net` TCP. That implementation would
be easier than the Workers port. It is still **not a viable complete production
host** because Hobby terminates every Function-backed WebSocket after five
minutes, taking the authenticated Telnet session with it. Its
non-commercial-personal-use restriction is a separate eligibility gate.

The practical ranking is:

1. **Cloudflare Workers Free:** deployed production host, with the remaining
   range and observation gates tracked above.
2. **Vercel Hobby plus an external persistent Node proxy:** feasible hybrid if
   the deployment is eligible for Hobby, but Vercel hosts only the static half.
3. **Vercel Hobby alone:** unsuitable for production MUD play because five
   minutes is not an acceptable session boundary.
