# 0002. MCCP and GMCP Protocol Direction

**Status:** Accepted
**Date:** 2026-05-11

## Context

Luminari Web currently connects the browser to a Telnet MUD through the
integrated Node proxy and the `/ws` application protocol. The proxy negotiates
selected Telnet options, parses MSDP, maps state into typed app messages, and
keeps unsupported features unavailable until source, proxy, client, and test
contracts exist.

Phase 04 audited two protocol candidates that can look ready from source-side
placeholders:

- MCCP has source constants and negotiation framework notes, but
  `CompressStart()` and `CompressEnd()` in Luminari-Source still only report
  that they do nothing. Luminari Web has no decompression layer and currently
  rejects `WILL MCCP` with `DONT MCCP`.
- GMCP has Luminari-Source negotiation, parse/send helpers, and Mudlet package
  delivery paths, but there is no stable web module contract, JSON schema set,
  proxy parser, client mapping, or fixture corpus. MSDP is the current tested
  first-party game-state protocol.

This ADR decides the current product direction. It does not implement runtime
compression, decompression, GMCP parsing, module schemas, or MSDP migration.

## Options Considered

### MCCP

1. Implement MCCP now.
   This would require zlib-backed source compression, proxy decompression,
   stream-boundary changes, reconnect cleanup, timeout/failure behavior, and
   compressed fixture coverage. It is too broad for a decision session.
2. Keep MCCP rejected in Luminari Web and allow future reconsideration only
   through a dedicated implementation spec.
   This preserves current safe behavior and prevents compressed bytes from
   reaching a proxy that cannot inflate them.
3. Reject MCCP permanently.
   This is too strong because compression may have deployment value after the
   source and proxy gates exist.

### GMCP

1. Implement GMCP now.
   This would require source module ownership, versions, schemas, proxy parsing,
   client mappings, MSDP coexistence rules, and malformed/reconnect fixtures.
   It is too broad for a decision session.
2. Defer GMCP as a future module contract while preserving MSDP as the current
   supported game-state path.
   This keeps the tested client contract stable and lets a later session design
   GMCP without silently replacing MSDP.
3. Reject GMCP permanently.
   This is too strong because a modern module contract may become useful if the
   source owns schemas and migration behavior.

## Decision

MCCP is rejected for the current Luminari Web path. The proxy must continue to
reject MCCP until both sides of the byte stream are implemented and tested:
source compression must be real, and proxy decompression must exist before any
parser sees compressed bytes.

GMCP is deferred for the web client and proxy. Luminari-Source GMCP helper code
is source evidence, not web support. MSDP remains the supported first-party
state path for current panels until a future GMCP session defines modules,
schemas, parser behavior, client mappings, coexistence with MSDP, and rollback.

No runtime behavior changes are approved by this ADR.

## Required MCCP Follow-Up Gates

- Source compression: implement and test `CompressStart()` and `CompressEnd()`,
  link zlib intentionally, and keep `USING_MCCP` disabled until validation
  passes.
- Proxy decompression: inflate MCCP bytes before text, MSDP, TTYPE, NAWS, or
  other Telnet parser handling.
- Reconnect cleanup: reset parser, decompressor, socket, MSDP, and app state
  across compressed and uncompressed reconnect cycles.
- Failure handling: corrupt compressed data, inflate errors, mid-stream closes,
  and timeouts must produce stable sanitized connection-status failures.
- Rollback: uncompressed sessions and MCCP rejection tests must remain available
  until support is explicitly enabled.

## Required GMCP Follow-Up Gates

- Module ownership: document source-owned module names, versions, payload
  ownership, and update timing.
- Schema validation: validate every JSON payload that crosses into the proxy or
  browser app with explicit schemas or type guards.
- MSDP coexistence: define precedence, deduplication, older-server fallback, and
  rollback behavior for data that overlaps with MSDP.
- Proxy parser: negotiate and parse GMCP without disrupting MSDP, terminal text,
  TTYPE, NAWS, or unsupported option handling.
- Client mapping: add typed shared mappings and fixtures for empty, partial,
  malformed, nested, oversized, and reconnect-sensitive payloads.
- Migration: keep current MSDP panels supported until GMCP parity is proven.

## Consequences

The protocol status catalog and maintainer docs can claim a clear current
direction without claiming unsupported behavior. MCCP remains a rejected Telnet
option in Luminari Web. GMCP remains deferred source/proxy/client work. The
first-party web path remains uncompressed browser JSON over `/ws`, an integrated
proxy Telnet socket, and MSDP-backed state mapping.

Future MCCP or GMCP implementation must be planned as scoped source, proxy,
client, and test work rather than hidden behind documentation wording.
