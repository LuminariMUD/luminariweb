# Development Guide

## Required Tools

- Node.js with npm.
- Git.

## Port Mappings

| Service          | Port | URL                     |
| ---------------- | ---- | ----------------------- |
| Vite frontend    | 5190 | `http://localhost:5190` |
| Proxy/API server | 5191 | `http://localhost:5191` |
| Vite preview     | 5192 | `http://localhost:5192` |

Ports are configured in `shared/app-settings.ts`.

## Dev Scripts

| Command                          | Purpose                                          |
| -------------------------------- | ------------------------------------------------ |
| `npm run dev`                    | Run the frontend and proxy together              |
| `npm run dev:client`             | Run Vite only                                    |
| `npm run dev:server`             | Run the proxy server with `tsx watch`            |
| `npm run lint`                   | Run ESLint                                       |
| `npm run build`                  | Type-check and build client/server output        |
| `npm run preview`                | Preview built frontend assets                    |
| `npm start`                      | Run the built server from `dist/server/index.js` |
| `npm run media`                  | Process changed onboarding media and manifest    |
| `npm run media:force`            | Reprocess all onboarding media and manifest      |
| `npm run dev:onboarding-preview` | Run the synthetic `/ws` design preview           |

## Local Workflow

1. Install dependencies with `npm install`.
2. Start both services with `npm run dev`.
3. Edit React code in `src/`, proxy code in `server/`, or shared contracts in `shared/`.
4. Check [Protocol Feature Checklist](protocol-feature-checklist.md) before changing protocol support claims.
5. Run `npm run lint`.
6. Run `npm run build`.
7. Run `npm test` for the fixture-backed MSDP state tests.

## Paired Onboarding Development

The companion MUD checkout for this workspace is `../Luminari-Source`. The
media-rich account and character creator requires its protocol-v1 onboarding
adapter; an older MUD correctly remains on the classic terminal.

After starting a local MUD on port `4100`, run:

```bash
PROXY_PUBLIC_MODE=false \
PROXY_ALLOW_LOCAL_DESTINATIONS=true \
LOCAL_MUD_PORT=4100 \
npm run dev
```

This is a development-only network opt-in. It adds a local preset and permits
loopback/private MUD targets while retaining metadata-service, link-local,
multicast, reserved, unspecified, and banned-port blocks. It is ignored in
public proxy mode.

For UI work without the real MUD or database, use either:

- `node scripts/synthetic-onboarding-mud.mjs 4444` with the integrated proxy
  configured to use `LOCAL_MUD_PORT=4444`; or
- `npm run dev:onboarding-preview` plus `npm run dev:client` for a direct
  synthetic `/ws` flow.

The preview server has no authentication and must stay local. See
[Structured Account and Character Onboarding](structured-onboarding.md) for
the full compatibility and deployment boundary.

## Testing

Run the focused test suite with:

```bash
npm test
```

The test script uses Node's built-in `node:test` runner with the existing `tsx`
loader. Current coverage includes onboarding contract, session, reducer, and
media-manifest tests as well as MSDP variable-map normalization,
configured-variable filtering, pure MSDP state mapping, fixture-driven
state-mapping checks, and shared display helpers for character, combat, group,
affects, inventory, room, map, and quest panels.

Phase 00 added the fixture and state-mapping test foundations. Phase 01 added Telnet parser, reconnect lifecycle, resize, and proxy safety coverage. Phase 02 added the shared display helpers and panel-state tests for the current HUD and sidebar surfaces. Phase 03 added the protocol feature status catalog, maintainer checklist, and source-level handoff notes. Browser-level UI verification remains separate work.

Run the focused protocol status tests after changing protocol claims:

```bash
node --import tsx --test tests/protocol-feature-status.test.ts
```

Protocol direction decisions are documented in ADRs. Read
[ADR 0002](adr/0002-mccp-and-gmcp-protocol-direction.md) before changing MCCP
or GMCP claims.

Treat protocol claims conservatively:

- Source facts prove source capability, not automatic web client support.
- Synthetic fixtures prove parser and client contracts, not live server schema.
- `TITLE`, `FORTITUDE`, `REFLEX`, `WILLPOWER`, text `ALIGNMENT`, and `MINIMAP`
  are source-backed defaults with fixture coverage.
- Live `DAMAGE_BONUS` and `QUEST_INFO` remain unavailable or override-only
  until side-effect-free damage and structured quest source contracts exist.
- MCCP stays rejected in Luminari Web until source compression and proxy
  decompression are implemented, tested, and rolled out through a dedicated
  spec.
- GMCP stays deferred until source modules, schemas, proxy parsing, client
  mappings, MSDP coexistence, fixtures, and rollback are planned.
- Native source WebSocket is deferred by ADR 0003. Do not claim support until
  future source transport, browser contract, security, operations,
  compatibility-test, and rollback gates pass.
- The integrated proxy remains the supported `/ws` path for the first-party
  React app.

## Generated Output

`dist/` is build output and is ignored by git. `node_modules/` is dependency output and is ignored by git.
