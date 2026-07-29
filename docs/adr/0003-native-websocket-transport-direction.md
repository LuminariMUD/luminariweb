# 0003. Native WebSocket Transport Direction

**Status:** Accepted
**Date:** 2026-05-11

## Context

Luminari Web currently connects the browser to a Telnet MUD through the
integrated Node proxy. The browser opens `/ws`, sends typed JSON application
messages, and receives typed terminal, state, and connection-status messages.
The proxy owns browser message validation, destination policy, origin checks,
connection quotas, command throttling, Telnet negotiation, MSDP parsing, state
mapping, sanitized status details, timeouts, and reconnect cleanup.

Phase 04 Session 05 evaluated whether Luminari-Source should expose a native
WebSocket listener for browser clients. The question is a transport and
operations decision, not a shortcut around the current proxy. A source-native
listener could be a raw terminal transport, a new source-owned application
protocol, or a compatibility implementation of the existing `/ws` contract.
Those options have different security, parser, client, and deployment costs.

The local `mud-r` reference demonstrates a dual Telnet/WebSocket server shape:
the game accepts a Telnet listener and a WebSocket listener, stores the
connection kind on the descriptor, buffers WebSocket frame payloads into the
input path, and writes terminal output as WebSocket text frames. This is useful
behavioral input, but it is not compatible with the Luminari Web `/ws` contract
by itself and is not copied into this project.

Luminari-Source currently has a Telnet descriptor lifecycle, protocol state,
copyover handling, and pulse-driven MSDP updates. It does not have an audited
native WebSocket listener today.

## Options Considered

### Keep Integrated Proxy As The Supported Path

This preserves the current application contract and keeps the existing
validation, policy, parser, state mapping, and status semantics in one tested
web service.

### Isolate The Integrated Proxy

This keeps the same `/ws` behavior while moving the proxy behind a stronger
process, host, container, network, reverse-proxy, or firewall boundary. It
improves operations without changing client contracts.

### Use A Terminal-Only Bridge

A raw bridge can be useful for a separate fallback terminal path. It cannot
serve the first-party React app because it does not validate browser JSON
messages, negotiate MSDP for the app, emit typed state, or preserve connection
status semantics.

### Use A Mapped Bridge

A mapped bridge can reduce arbitrary destination risk compared with an open
bridge, but it is still blind to the Luminari Web application protocol and
game-state contract. It remains a separate fallback option only.

### Add Native Source WebSocket

A native source listener may be worth reconsidering later if it reduces
deployment complexity without weakening security or client behavior. It would
need explicit source descriptor, parser, copyover, TLS/WSS, logging, quota,
observability, and rollback design. It also needs a browser contract decision:
raw terminal, source-owned app protocol, or existing `/ws` compatibility.

## Decision

Defer native Luminari-Source WebSocket support behind dedicated future specs.

The integrated Luminari Web proxy remains the supported production path for the
first-party React app. Operators who need stronger isolation should isolate the
integrated proxy before replacing it.

Terminal-only and mapped bridges remain separate fallback transports only. They
must not be described as implementations of the current `/ws` application
contract.

Native source WebSocket remains a candidate only after future work proves the
required source, client, security, operations, test, and rollback gates. Until
those gates pass, product and maintainer docs must not claim native source
WebSocket support.

## Required Native Transport Gates

- Browser contract: decide whether the source listener is raw terminal, a new
  source-owned application protocol, or compatibility with the existing `/ws`
  JSON contract.
- Source descriptor lifecycle: define how WebSocket descriptors are created,
  polled, written, closed, saved, and cleaned up alongside Telnet descriptors.
- Protocol parser behavior: define how WebSocket frames interact with line
  input, Telnet negotiation, MSDP, GMCP, MCCP rejection, unsupported options,
  malformed payloads, and reconnect cleanup.
- Copyover behavior: decide whether WebSocket descriptors survive copyover and
  test restoration or intentional disconnect behavior.
- Browser security: define origin policy, auth or authorization expectations,
  message validation, and error boundaries at the browser-facing listener.
- Abuse controls: implement connection quotas, command throttles, timeouts, and
  policy rejection counters without logging private payloads.
- Operations: define WSS/TLS termination, reverse-proxy headers, health probes,
  firewall exposure, deployment flags, and operator runbooks.
- Privacy: keep command text, credentials typed inside the MUD, private hosts,
  character names from live sessions, terminal transcripts, tokens, and raw
  frame payloads out of default logs and docs.
- Observability: provide sanitized accept, reject, parser-failure, close, and
  rollback metrics.
- Rollback: keep the integrated proxy deployable and documented until source
  native transport parity is proven.

## Consequences

The current app contract stays stable: browser JSON over `/ws`, an integrated
proxy Telnet socket, and MSDP-backed state mapping. Luminari Web status
surfaces should continue to mark native source WebSocket as deferred rather
than supported.

Future native transport work must be split into source transport, browser
contract, proxy/client compatibility, security, operations, and validation
sessions. Any implementation that tries to replace `/ws` with a raw byte stream
is rejected by this decision.

The rollback path remains straightforward for the current product: redeploy the
known-good integrated proxy revision or route clients back to the existing
`/ws` service. A future native listener must preserve that fallback until it is
explicitly promoted by a later ADR or implementation spec.
