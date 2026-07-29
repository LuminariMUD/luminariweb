# Protocol Feature Checklist

This checklist is the maintainer-facing protocol status contract for Luminari
Web. The source of truth for app and test code is
[`shared/protocol-feature-status.ts`](../shared/protocol-feature-status.ts).
The checklist is deliberately conservative: a feature is not marked supported
unless the current client and proxy can prove the behavior with source facts,
tests, or documented runtime contracts.

## Status Key

| Status         | Meaning                                                                           |
| -------------- | --------------------------------------------------------------------------------- |
| Supported      | Current client/proxy behavior is implemented and covered by tests or stable docs. |
| Partial        | A bounded part exists, but the full protocol claim still needs validation.        |
| Rejected       | The proxy or product deliberately refuses the feature today.                      |
| Deferred       | Future source, proxy, or product work is required before implementation.          |
| Validation gap | Source facts or placeholders exist, but web support is unproven.                  |

## Terminal and Text

| Feature               | Status    | Current boundary                                                                     | Evidence                                                                                                                                       | Next action                                               |
| --------------------- | --------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| ANSI terminal text    | Supported | Browser renders escaped ANSI terminal output from proxy text messages.               | [`tests/terminal-renderer.test.ts`](../tests/terminal-renderer.test.ts), [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)                             | Keep renderer tests passing when terminal output changes. |
| 256-color client flag | Partial   | Proxy advertises `256_COLORS` through MSDP; broad live color coverage is not proven. | [`server/mud-session.ts`](../server/mud-session.ts), [`tests/terminal-renderer.test.ts`](../tests/terminal-renderer.test.ts)                   | Add source/live capture evidence before broader claims.   |
| UTF-8 text decoding   | Supported | Telnet text is decoded with UTF-8 and the proxy advertises `UTF_8`.                  | [`server/telnet-parser.ts`](../server/telnet-parser.ts), [`tests/telnet-parser-edge-cases.test.ts`](../tests/telnet-parser-edge-cases.test.ts) | Keep split-control and UTF-8 parser tests passing.        |

## Telnet Negotiation

| Feature | Status    | Current boundary                                                                     | Evidence                                                                                                                                                                                                 | Next action                                                                                                                    |
| ------- | --------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| TTYPE   | Supported | Proxy agrees to TTYPE and replies to SEND with a fixed web client name.              | [`server/telnet-parser.ts`](../server/telnet-parser.ts), [`tests/telnet-parser-edge-cases.test.ts`](../tests/telnet-parser-edge-cases.test.ts)                                                           | Keep TTYPE negotiation tests passing.                                                                                          |
| NAWS    | Supported | Proxy negotiates NAWS and sends bounded dimensions after support is known.           | [`server/telnet-parser.ts`](../server/telnet-parser.ts), [`tests/proxy-lifecycle.test.ts`](../tests/proxy-lifecycle.test.ts)                                                                             | Keep lifecycle and resize tests passing.                                                                                       |
| MXP     | Rejected  | Proxy rejects MXP; server markup is not trusted UI input.                            | [`server/telnet-parser.ts`](../server/telnet-parser.ts), [`shared/protocol-feature-status.ts`](../shared/protocol-feature-status.ts)                                                                     | Keep rejected until a safe parser/UI design exists.                                                                            |
| MCCP    | Rejected  | Proxy rejects MCCP; source compression is stubbed and proxy decompression is absent. | [`server/telnet-parser.ts`](../server/telnet-parser.ts), [`tests/telnet-parser-edge-cases.test.ts`](../tests/telnet-parser-edge-cases.test.ts), [ADR 0002](adr/0002-mccp-and-gmcp-protocol-direction.md) | Keep rejected unless a future source/proxy spec implements compression, decompression, reconnect, failure, and rollback gates. |
| CHARSET | Rejected  | Proxy rejects CHARSET and keeps UTF-8 decoding fixed.                                | [`server/telnet-parser.ts`](../server/telnet-parser.ts), [`tests/telnet-parser-edge-cases.test.ts`](../tests/telnet-parser-edge-cases.test.ts)                                                           | Defer alternate encodings until tested source/proxy policy exists.                                                             |

## Game State Protocols

| Feature                 | Status    | Current boundary                                                                                                                                                                        | Evidence                                                                                                                                                        | Next action                                                                         |
| ----------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| MSDP                    | Supported | MSDP is the current structured game-state path for source-confirmed values and configured overrides.                                                                                    | [`shared/mud.ts`](../shared/mud.ts), [`tests/README.md`](../tests/README.md)                                                                                    | Use Phase 04 for missing variables and live schema confirmation.                    |
| Selected MSDP additions | Partial   | `TITLE`, `FORTITUDE`, `REFLEX`, `WILLPOWER`, source-backed `MINIMAP`, and text `ALIGNMENT` are selected from source facts with web fixture coverage; older servers may still omit them. | [`shared/mud.ts`](../shared/mud.ts), [Source Protocol Backlog](source-protocol-backlog.md), [`tests/fixtures/msdp/README.md`](../tests/fixtures/msdp/README.md) | Keep source harness and web fixtures aligned before marking fully supported.        |
| Deferred MSDP fields    | Deferred  | Live `DAMAGE_BONUS` and `QUEST_INFO` stay unavailable or override-only by default.                                                                                                      | [`shared/mud.ts`](../shared/mud.ts), [Source Protocol Backlog](source-protocol-backlog.md)                                                                      | Add only after side-effect-free source damage and structured quest contracts exist. |

## Source-Level Follow-Ups

| Feature                 | Status         | Current boundary                                                                                                                     | Evidence                                                                                                                                                                                 | Next action                                                                                                                                  |
| ----------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| GMCP                    | Deferred       | Source helpers exist, but the web client and proxy have no GMCP module contract, parser, schemas, mappings, or tests.                | [ADR 0002](adr/0002-mccp-and-gmcp-protocol-direction.md), [`tests/README.md`](../tests/README.md)                                                                                        | Defer until source module ownership, schema validation, MSDP coexistence, proxy parsing, client mapping, fixtures, and rollback are planned. |
| MSP                     | Deferred       | Source negotiation code exists; browser audio behavior is not specified or implemented.                                              | [Historical PRD source facts](prev_prd/PRD.md), [`tests/README.md`](../tests/README.md)                                                                                                  | Defer until product requirements define audio behavior and tests.                                                                            |
| MSSP                    | Validation gap | Source support is recorded, but the web client does not consume MSSP data.                                                           | [Historical PRD source facts](prev_prd/PRD.md), [`tests/README.md`](../tests/README.md)                                                                                                  | Decide whether the web client needs MSSP before parser/UI work.                                                                              |
| Native source WebSocket | Deferred       | ADR 0003 defers native source WebSocket support; integrated proxy and `/ws` application messages remain the supported app transport. | [ADR 0003](adr/0003-native-websocket-transport-direction.md), [`docs/bridge-deployment-options.md`](bridge-deployment-options.md), [Source Protocol Backlog](source-protocol-backlog.md) | Plan native transport only through dedicated future source, browser contract, security, operations, compatibility-test, and rollback specs.  |

## Source Parser Harness

Phase 04 Session 02 added a source-side CuTest harness at
`/home/aiwithapex/projects/Luminari-Source/unittests/CuTest/test_protocol_parser.c`
with maintainer instructions in
`/home/aiwithapex/projects/Luminari-Source/docs/testing/PROTOCOL_PARSER_HARNESS.md`.
Run it with:

```sh
cd /home/aiwithapex/projects/Luminari-Source/unittests/CuTest
make protocol-parser
```

This is validation coverage for future source changes, not a new protocol
support claim. The harness currently covers doubled `IAC`, current split `IAC`
gap behavior, incomplete subnegotiation, malformed MSDP and GMCP, TTYPE, valid
NAWS, unsupported option rejection, oversized MSDP list rejection, overlong MXP
tag passthrough, bounded copyover strings, and bounded MSSP output.

Known source gaps remain: split `IAC` and incomplete subnegotiation payloads are
not retained across `ProtocolInput()` calls, and short NAWS payloads still need
source parser bounds hardening before they can be asserted as safe behavior.

## Phase 04 Inputs

Phase 04 should use the [Source Protocol Backlog](source-protocol-backlog.md)
to split source work into:

- `p4-source-todo-audit` - Re-read Luminari-Source protocol TODOs and rank source changes; current audit output is [Source Protocol Backlog](source-protocol-backlog.md).
- `p4-parser-harness` - Add source-level protocol parser fixtures before changing behavior.
- `p4-missing-msdp-variables` - Decide and implement only selected source-owned MSDP variables.
- `p4-mccp-gmcp-decision` - Completed by [ADR 0002](adr/0002-mccp-and-gmcp-protocol-direction.md): MCCP remains rejected today and GMCP remains deferred.
- `p4-native-websocket-feasibility` - Completed by
  [ADR 0003](adr/0003-native-websocket-transport-direction.md):
  native source WebSocket remains deferred behind future source, browser
  contract, security, operations, compatibility-test, and rollback gates.

## Claim Boundaries

- Do not claim MCCP support while source compression functions are stubs and proxy decompression is absent; ADR 0002 keeps it rejected in the current web path.
- Do not claim GMCP support without a source module API, proxy parser, client contract, schema validation, MSDP coexistence plan, and tests; ADR 0002 keeps it deferred.
- Do not claim live `DAMAGE_BONUS` or `QUEST_INFO` support from synthetic fixtures alone.
- Do not claim full support for selected `TITLE`, saves, or `MINIMAP` without source emission, web mapping fixtures, and older-server fallback coverage.
- Do not treat a blind WebSocket-to-TCP bridge as an implementation of the `/ws` application protocol.
- Do not claim native source WebSocket support until ADR 0003 follow-up gates
  pass.
- Do not parse free-form quest command output as structured quest data.

## Manual UI Checks

If the Protocol inspector tab is changed, check desktop, 390px, and 360px
widths. Verify the tab is keyboard reachable, status labels wrap inside the
inspector, long notes do not create horizontal page scrolling, and command input
focus returns after selecting the tab.
