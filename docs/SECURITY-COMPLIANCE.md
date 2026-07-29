# Security & Compliance

> Cumulative security posture and GDPR compliance record. Updated between phases via carryforward.
> **Line budget**: 1000 max | **Last updated**: Managed-mTLS transport closure (2026-07-29)

---

## Current Security Posture

### Overall: NO OPEN FINDINGS / MANAGED mTLS ACTIVE

| Metric           | Value |
| ---------------- | ----- |
| Open Findings    | 0     |
| Critical/High    | 0     |
| Medium/Low       | 0     |
| Phases Audited   | 7     |
| Last Clean Phase | mTLS  |

---

## Open Findings

None.

---

## Resolved Findings

Recently closed issues are retained here for phase history and regression awareness.

| Finding                                                       | Severity | Resolution                                                                                                                                                                                                                                                                                                                                                                                               | Closed     |
| ------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| ONBOARD-SEC-001 Proxy-to-MUD web login leg was plain Telnet   | High     | Activation Worker version `e35c6199-4981-463b-b5f1-29ef5bb01885` opened only a fixed managed-mTLS WebSocket to exact-name Apache. Apache required the dedicated client certificate and proxied to a loopback-only Node gateway, which dialed only `127.0.0.1:4100`. No plaintext fallback existed. Pre-cutover web sessions were drained. See the [closure evidence](#onboard-sec-001-closure-evidence). | 2026-07-29 |
| P00-SEC-002 Browser settings are stored in cookies            | Medium   | Phase 03 moved browser settings, aliases, and triggers to versioned `localStorage`, and legacy cookie groups are cleared only after a valid local payload is written.                                                                                                                                                                                                                                    | P03        |
| P00-SEC-001 Public proxy can target arbitrary hosts and ports | High     | Phase 01 added destination allowlists, origin checks, DNS/IP classification, banned service ports, and connect/idle timeouts before socket creation.                                                                                                                                                                                                                                                     | P01        |
| P00-SEC-003 Command/input rate limiting implemented locally   | Medium   | HTTP requests are rate limited per IP, browser command input is throttled per WebSocket session, and concurrent WebSocket connections are capped per IP.                                                                                                                                                                                                                                                 | P00        |
| P00-SEC-004 HTML rendering depends on escaping invariants     | Low      | Phase 01 preserved escaped HTML rendering in shared helpers and added renderer coverage before any xterm opt-in path was exposed.                                                                                                                                                                                                                                                                        | P01        |
| P00-SEC-005 No automated security regression tests            | Low      | Phase 01 added parser, lifecycle, resize, policy, and renderer tests, plus passing lint/build/test coverage.                                                                                                                                                                                                                                                                                             | P01        |

### ONBOARD-SEC-001 Closure Evidence

The web-session finding is resolved, not accepted:

- Closure was proved with secure activation version
  `e35c6199-4981-463b-b5f1-29ef5bb01885` at 100% traffic. Later deployments
  may supersede that version only while retaining the managed-mTLS binding and
  fail-closed route; the prior direct-TCP version remains an explicit
  security-rollback artifact only.
- Cloudflare validates the public chain and exact
  `mud-origin.luminarimud.com` hostname and presents dedicated managed client
  identity serial `1001`.
- Apache requires the client certificate in the initial TLS handshake, checks
  the current CRL, and proxies only `/gateway/ws`.
- The gateway listens only at `127.0.0.1:5191` and can dial only
  `127.0.0.1:4100`.
- Missing, untrusted, expired, and revoked clients; wrong hostname; TLS 1.1;
  raw Telnet; absent binding; and origin failure all fail closed with zero MUD
  application bytes and no direct port-`4100` retry.
- The client identity was rotated under overlap. Predecessor serial `1000` was
  revoked, rejected after CRL reload, removed from Cloudflare, and replaced by
  tracked successor serial `1001`.
- Production desktop, `390 x 844`, and `360 x 740` v2 RP and terminal flows
  passed. An invented private value round-tripped exactly and did not enter
  browser storage.
- Public-interface captures contained none of the exact invented account,
  password, command, terminal-output, onboarding, or RP markers. Accepted
  captures remain mode-`0600`, root-only, off Git.
- The controlled pre-cutover web session was disconnected. A fresh production
  session created one Apache-to-gateway and one gateway-to-loopback-MUD socket;
  browser close drained both to zero. No Worker/public peer reached port
  `4100`.
- A clean pre-publication GitHub-hosted run independently passed public health
  freshness, exact DNS/hostname, mandatory
  client authentication, raw-Telnet rejection, tracked-certificate, and expiry
  gates against the live route. The route-free deployed canary, external
  runner, and public packet observation provided checks independent of the
  production Worker process itself.
- Rotation, rollback, alert failure/recovery, and incident procedures were
  exercised and are owned by the
  [mTLS transport runbook](runbooks/mtls-transport.md).

Public port `4100` remains available to legacy direct-Telnet clients. That
separate service is plaintext and is not included in this web-transport
closure.

---

## GDPR Compliance Status

### Overall: LOW STORAGE / AUTHENTICATED TRANSIT

### Personal Data Inventory

No web-owned account system, database, analytics, payment flow, or server-side
profile storage exists in this repository. Authentication and persistence stay
inside the connected MUD.

Browser-local data currently includes:

- Client display settings
- Layout preferences
- MSDP variable mappings
- Aliases
- Triggers
- Protocol inspector tab state
- Imported and exported local configuration files

Phase 04 added no new browser-local personal-data categories. Structured
onboarding v2 adds private role-play profile text to the transit categories
below but does not add browser-local or web-owned account storage.

Potentially sensitive operational data:

- Player command text passes through Cloudflare and the origin gateway to the
  selected MUD but is not intentionally logged by current code.
- MUD host and port are sent to the proxy during connection.
- Account names, passwords, character names, and character summaries transit
  the integrated proxy during structured or classic onboarding but are not
  intentionally persisted by this repository.
- Role-play descriptions, background, goals, personality, ideals, bonds, and
  flaws transit the gateway in bounded v2 envelopes, are cleared with the
  session lifecycle, and are not intentionally logged or browser-persisted.
- Structured onboarding state is runtime-validated and is cleared on
  disconnect; passwords are excluded from history, automation, completion,
  browser storage, and the service-worker cache.
- Production browser traffic uses HTTPS/WSS to Cloudflare and managed mutual
  TLS from the Worker to the exact MUD origin. The remaining Node and MUD hops
  are host-loopback only.

### Compliance Checklist

| Requirement                            | Status  | Notes                                                                                                                                                                |
| -------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data collection has documented purpose | Partial | Browser-local settings support gameplay preferences; no web-owned server-side account store exists.                                                                  |
| Consent obtained before data storage   | Partial | Settings are saved through app controls, but there is no explicit storage notice.                                                                                    |
| Data minimization verified             | Pass    | Account secrets transit but are not stored; client settings stay in browser-local storage instead of cookies.                                                        |
| Deletion/erasure path exists           | Partial | Users can clear browser storage through normal browser controls; no in-app clear-all control is documented.                                                          |
| No PII in application logs             | Pass    | Current code does not intentionally log command text, passwords, account names, onboarding state, or character lists.                                                |
| Third-party transfers documented       | Partial | Cloudflare processes live session data in memory; the fixed MUD host receives it through authenticated transport. Legacy direct Telnet remains separately plaintext. |

## Dependency Security

`npm audit --omit=dev --audit-level=moderate` reported 0 production dependency vulnerabilities after the phase 01 xterm spike and proxy hardening.

Top-level runtime dependencies observed:

- `@xterm/addon-fit`
- `@xterm/xterm`
- `ansi-to-html`
- `express`
- `react`
- `react-dom`
- `ws`

Development dependencies include Vite, TypeScript, ESLint, React plugin packages, `tsx`, and `concurrently`.

## Phase History

| Phase   | Sessions                           | Security                                                                                                             | GDPR                         | Findings Opened | Findings Closed |
| ------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------- | --------------- |
| 00      | 5/5 complete                       | Initial code scan                                                                                                    | Local-only baseline          | 4               | 1               |
| 01      | 6/6 complete                       | Proxy safety hardened and renderer coverage expanded                                                                 | Local-only baseline retained | 0               | 4               |
| 02      | 6/6 complete                       | Panel expansion remained client-side; no new findings introduced                                                     | Local-only baseline retained | 0               | 0               |
| 03      | 6/6 complete                       | Browser-local settings moved off cookies; protocol inventory and deployment posture documented                       | Local-only baseline retained | 0               | 1               |
| 04      | 5/5 complete                       | Protocol claim boundaries, parser harnesses, and native transport decisions were clarified                           | Local-only baseline retained | 0               | 0               |
| ONBOARD | Protocol v2 live                   | Structured login/private-content validation, sensitive-input handling, and local-target boundaries were audited      | Transit inventory expanded   | 1               | 0               |
| mTLS    | Managed-mTLS production route live | Mutual authentication, fail-closed behavior, capture, rotation, rollback, alerts, session drain, and runbooks passed | Public web transit protected | 0               | 1               |

## Recommendations

1. Keep browser settings, aliases, triggers, and layout preferences in browser-local storage only; do not reintroduce cookies or store secrets.
2. Keep the public proxy allowlist, origin, DNS/IP, and timeout checks fail-closed.
3. Treat the protocol inventory as evidence-backed documentation, not runtime proof of support.
4. Keep command logging disabled by default.
5. Keep service-worker caching limited to the static shell and never cache live protocol traffic.
6. Keep the integrated `/ws` proxy as the supported browser contract until a separate native source transport spec proves parity.
7. Maintain the
   [mTLS transport runbook](runbooks/mtls-transport.md), certificate/CRL
   monitors, external gate, rotation, and rollback drills. Reopen
   `ONBOARD-SEC-001` before any plaintext security rollback, or before
   expanding or weakening the fixed route.

_Auto-generated by carryforward. Updated between phases._
