# Luminari Web Product Requirements and Delivery Plan

Prepared for: M. Ben Avraham / LuminariMUD
Prepared: 2026-05-10
Consolidates: Web MUD client shortlist, Luminari-Source protocol audit, reference repository metadata, and delivery plan.
Spec source of truth: This file contains the complete planning content formerly maintained in `docs/plan.md`, including planning, reference, protocol, and delivery details.

## Overview

Luminari Web is a first-party browser client for LuminariMUD-compatible games. It combines a React frontend with a Node WebSocket-to-Telnet proxy so players can connect from a browser while receiving structured game state through MSDP.

The product direction is not a generic terminal clone. The goal is a Luminari-aware webclient that preserves the text-first MUD experience while adding reliable protocol handling, game panels, mobile-friendly ergonomics, and a delivery path that can grow toward richer mapper, automation, and possible future server-side protocol work.

This plan includes the local shortlist and protocol audit previously kept as a separate survey note. The project root (`/home/aiwithapex/projects/luminariweb`) is the active first-party client codebase, originally derived from `GickerLDS/LuminariWebClient`. `mud-web-client`, `mud-web-proxy`, `lociterm`, `websockify`, `wsgate-server`, and `mud-r` are references only, each with licensing and architecture constraints noted below.

## Delivery Model

The project is divided into phases and sessions sized for AI-assisted implementation:

- One session equals one spec.
- One session has one clear objective.
- One session should fit in 2-4 hours.
- One session should contain roughly 12-25 implementation tasks.
- One phase is a meaningful collection of 3-8 sessions.
- The project has as many phases as needed to complete the goals in this plan.

Session entries in this plan are intentionally right-sized objectives, not full implementation task lists. Each session should later be expanded into a detailed spec and 12-25 task checklist immediately before implementation.

## Goals

1. Align the client with real Luminari-Source MSDP variables and stop depending on data that the server does not currently emit.
2. Harden the Telnet proxy, MSDP parser, connection lifecycle, and terminal behavior so browser play is reliable under real MUD traffic.
3. Build Luminari-specific game panels for character state, combat, group, affects, inventory, room, and map workflows.
4. Borrow proven UX and architecture ideas from shortlisted clients without importing incompatible license obligations.
5. Improve mobile and installable-browser play so the client is useful beyond desktop.
6. Create a measured path for future Luminari-Source protocol changes after the proxy client is stable.
7. Keep each increment testable, reviewable, and sized for a single focused coding session.

## Non-Goals

- Do not build a generic multi-MUD terminal at the expense of Luminari-specific workflows.
- Do not import GPL-3.0 code from `mud-web-client` or `mud-web-proxy` unless the project intentionally accepts GPL inheritance.
- Do not add native WebSocket support to Luminari-Source before the proxy client is stable and protocol parser risks are understood.
- Do not treat MCCP as available until Luminari-Source implements real compression or the proxy implements decompression correctly.
- Do not rely on `TITLE`, `QUEST_INFO`, `FORTITUDE`, `REFLEX`, `WILLPOWER`, or live `MINIMAP` data until the server emits those values or the client has explicit fallback behavior.
- Do not build server-side quest, mapper, or GMCP features before the current MSDP foundation is tested.
- Do not make broad source-level protocol changes without targeted tests and rollback paths.

## Users and Use Cases

### Primary Users

- **Luminari players**: Players who want a browser-based client with useful character, combat, group, and room information.
- **Mobile players**: Players who want a small-screen or installable client for casual play, reconnecting, and checking character state.
- **Builders and staff**: Luminari maintainers who need a first-party client aligned with actual server protocol behavior.
- **Developers and AI coding agents**: Implementers who need clear phase/session boundaries and verifiable acceptance criteria.

### Key Use Cases

1. Player connects to a configured LuminariMUD-compatible server from a browser.
2. Player reads ANSI-colored room and game output in a terminal-like pane.
3. Player sends commands with history, aliases, triggers, and movement shortcuts.
4. Player sees live HP, PSP, movement, XP/TNL, AC, attack, money, position, combat target, and tank state.
5. Player inspects character details, group members, affects, inventory, and room context.
6. Player uses a room/map panel based on reliable room and exit data.
7. Player reconnects cleanly after network or server disconnects.
8. Player uses the client comfortably on desktop and small screens.
9. Maintainer can verify protocol behavior with fixtures and tests before expanding features.

## Current Product Facts

- The current app is React, TypeScript, Vite, Express, and `ws`.
- The Node server bridges browser WebSocket traffic to a Telnet MUD.
- The proxy negotiates Telnet options, requests MSDP variables, and rejects MCCP today.
- The frontend already has a custom HTML terminal renderer, HUD bars, character/group/quest/affects tabs, aliases, triggers, command history, movement shortcuts, settings, import/export behavior, and runtime `/api/settings`.
- The current default MSDP map still includes variables that the Luminari-Source audit says are not currently emitted by the server.
- There is no committed test suite for parser behavior, proxy lifecycle, or UI state mapping yet.

## Technical Stack

- TypeScript - shared language for frontend, proxy, and shared protocol types.
- React 19 - browser UI for terminal, HUD, panels, settings, aliases, and triggers.
- Vite - frontend development and production bundling.
- Node.js - runtime for the WebSocket-to-Telnet proxy and static serving.
- Express - HTTP server for health, runtime settings, and static client delivery.
- `ws` - browser WebSocket server and message transport.
- Native `net` sockets - Telnet connection from the proxy to MUD servers.
- CSS - application styling, responsive layout, and terminal presentation.
- Luminari-Source - authoritative source for supported protocol variables and future server changes.

## Source Protocol Facts

The plan assumes the following audited Luminari-Source facts:

Sources inspected:

- `/home/aiwithapex/projects/Luminari-Source/src/protocol.h`
- `/home/aiwithapex/projects/Luminari-Source/src/protocol.c`
- `/home/aiwithapex/projects/Luminari-Source/src/comm.c`
- `/home/aiwithapex/projects/Luminari-Source/docs/systems/PROTOCOL_SYSTEMS.md`
- `/home/aiwithapex/projects/Luminari-Source/docs/systems/MSDP_VARIABLES.md`
- `/home/aiwithapex/projects/Luminari-Source/docs/project-management-zusuk/PROTOCOL_TODO.md`

- KaVir Protocol Snippet v8 is integrated.
- MSDP is implemented and is the best current integration point.
- GMCP negotiation and send/parse functions exist, but are not yet a full modern JSON module API.
- MSSP is implemented.
- MXP, MSP, TTYPE, NAWS, and CHARSET negotiation code exists.
- MCCP is compiled behind `USING_MCCP`, but `CompressStart()` and `CompressEnd()` are stubs.
- No native WebSocket listener exists in the current Luminari source tree.

Confirmed MSDP table variables include:

- Server/client: `SERVER_ID`, `SERVER_TIME`, `SNIPPET_VERSION`, `CLIENT_ID`, `CLIENT_VERSION`, `PLUGIN_ID`, `ANSI_COLORS`, `256_COLORS`, `UTF_8`, `SOUND`, `MXP`
- Character: `CHARACTER_NAME`, `LEVEL`, `RACE`, `CLASS`, `POSITION`, `ALIGNMENT`, `MONEY`, `PRACTICE`, `WIMPY`
- Resources: `HEALTH`, `HEALTH_MAX`, `PSP`, `PSP_MAX`, `MOVEMENT`, `MOVEMENT_MAX`, `EXPERIENCE`, `EXPERIENCE_MAX`, `EXPERIENCE_TNL`
- Combat: `ATTACK_BONUS`, `DAMAGE_BONUS`, `AC`, `OPPONENT_NAME`, `OPPONENT_LEVEL`, `OPPONENT_HEALTH`, `OPPONENT_HEALTH_MAX`, `TANK_NAME`, `TANK_HEALTH`, `TANK_HEALTH_MAX`
- Ability scores: `STR`, `INT`, `WIS`, `DEX`, `CON`, `CHA`, and permanent score variants
- Collections: `AFFECTS`, `INVENTORY`, `ACTIONS`, `GROUP`
- Room/world: `ROOM`, `AREA_NAME`, `ROOM_EXITS`, `ROOM_NAME`, `ROOM_VNUM`, `WORLD_TIME`, `SECTORS`, `MINIMAP`
- GUI hints: `BUTTON_1` through `BUTTON_5`, `GAUGE_1` through `GAUGE_5`

Important mismatches to resolve:

| Area                  | Current fact                                                         | Product impact                                                |
| --------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| `TITLE`               | Requested by current client, not present in `VariableNameTable`      | Character title UI needs fallback or a future server variable |
| `QUEST_INFO`          | Requested by current client, not present in `VariableNameTable`      | Quest tab needs another data source or future server work     |
| Saves                 | `FORTITUDE`, `REFLEX`, and `WILLPOWER` are requested but not present | Save widgets need removal, fallback, or server variables      |
| `MINIMAP`             | Declared, but no audited `MSDPSet*` population call found            | Minimap UI must not assume live data                          |
| `ROOM` / `ROOM_EXITS` | Populated by source, but not in current default request map          | Room/map work should start with these values                  |
| `DAMAGE_BONUS`        | Defined, but update path appears commented out                       | Damage bonus HUD should wait for live confirmation            |
| MCCP                  | Negotiation exists, compression functions are stubs                  | Proxy should keep rejecting MCCP until real support exists    |

## Requirements

### MVP Requirements

- Player can connect to a configured MUD host and port through the browser proxy.
- Player can disconnect and reconnect without stale socket, parser, or UI state leaking across sessions.
- Player can read ANSI-colored game output in a scrollable terminal pane.
- Player can send commands through a focused command input with command history.
- Player can use movement shortcuts without polluting command history.
- Player can configure aliases, triggers, display settings, and MSDP variable mappings.
- Player can see live Luminari resource bars for emitted MSDP values.
- Player can see character, combat, group, affects, room, and inventory panels when matching MSDP data is available.
- Player can distinguish unavailable server data from empty or failed client rendering.
- Maintainer can run lint, type/build checks, and parser/proxy tests locally.
- Maintainer can validate parser behavior for split IAC sequences, doubled IAC bytes, tables, arrays, malformed MSDP, and reconnect cleanup.

### Deferred Requirements

- Player can use a richer mapper inspired by `mud-web-client` after room payloads are confirmed.
- Player can use a PWA/installable experience with reconnect-aware mobile ergonomics.
- Player can use xterm.js if the custom renderer proves insufficient.
- Player can benefit from GMCP modules if Luminari-Source grows a stable module API.
- Player can use MCCP if the server implements real compression and the proxy safely decompresses it.
- Maintainer can deploy a standalone bridge mode using `websockify` or `wsgate-server` patterns if production isolation requires it.
- Maintainer can consider native WebSocket support in Luminari-Source after proxy and protocol tests are mature.

## Non-Functional Requirements

- **Performance**: Terminal append and HUD updates should stay below 100 ms perceived latency for normal MUD output bursts up to 50 messages per second in local testing.
- **Parser correctness**: Parser tests must cover split IAC sequences, doubled IAC bytes, MSDP tables, MSDP arrays, malformed subnegotiations, TTYPE, NAWS, and reconnect cleanup before protocol expansion.
- **Reliability**: Reconnect testing must pass 25 consecutive connect/disconnect cycles without stale state or unhandled exceptions.
- **Security**: Proxy must validate host/port input, reject malformed browser messages, enforce connection quotas/rate limits before public deployment, and avoid logging player commands by default.
- **Privacy**: Client settings stored in browser storage must not include passwords or secrets.
- **Accessibility**: Interactive controls must be keyboard reachable, visible focus states must be present, and color-coded HUD states must also expose text labels.
- **Mobile usability**: Core connect, terminal, command input, and primary HUD workflows must be usable at 390px viewport width, with 360px smoke coverage when UI changes, without horizontal page scrolling.
- **Browser support**: First-release browser play must support latest stable Chrome, Edge, Firefox, and Safari on desktop, plus current Android evergreen browsers and Safari on iOS.
- **Build quality**: `npm run lint` and `npm run build` must pass before each phase is marked complete.

## Constraints and Dependencies

- The codebase is a single React/Node TypeScript project, not a multi-package workspace.
- Browser clients cannot directly open Telnet sockets, so a proxy remains required.
- Luminari-Source is the protocol authority for emitted data.
- First public deployment targets curated LuminariMUD-compatible d20MUD presets, with LuminariMUD as the protocol authority and compatibility reference.
- Public proxy deployments must reject arbitrary host/port targets by default and allow only configured, vetted MUD destinations.
- First-release client preferences, aliases, triggers, and layouts are browser-local only; account-linked or cloud settings require a later auth/privacy design.
- GPL-3.0 repositories may be studied for behavior and UX patterns, but code copying is out of scope unless licensing strategy changes.
- `lociterm` uses a very different stack and should guide mobile/PWA behavior rather than implementation.
- `websockify` and `wsgate-server` are bridge references, not game-aware clients.
- `mud-r` is useful only as a future native WebSocket architecture reference.
- Tests should use fixtures from real or representative Luminari MSDP payloads where possible.

## Resolved Product Decisions

These decisions resolve the former open questions and should be treated as settled planning guidance unless new source facts or production constraints invalidate them.

### Public Target and Presets

Decision: first public release should target the curated LuminariMUD-compatible d20MUD family, not every arbitrary MUD and not LuminariMUD alone. Keep the existing preset model for known compatible games such as Krynn, LuminariMUD, Faerun, and d20 Star Wars, but mark LuminariMUD as the protocol compatibility authority. Presets must be curated and smoke-tested; failing or unverified presets should be hidden or labeled experimental.

Evidence:

- The current app and README already describe the product as a client for LuminariMUD-compatible games.
- `shared/app-settings.ts` already contains curated d20MUD/Luminari-compatible presets rather than a generic directory.
- The audited Luminari-Source protocol table is the only source-level contract available, so compatibility claims must be tested against that contract.

Implementation implications:

- Public UI may show curated presets.
- Public proxy policy must allow only configured preset host/port pairs unless an operator explicitly enables custom routing for a private deployment.
- Acceptance testing starts with LuminariMUD and then verifies each listed compatible preset.

### Quest Support

Decision: do not parse free-form quest command output for first release. Keep the quest panel as an unavailable or optional-data state until Luminari-Source emits structured quest data. The preferred future path is a new server-emitted MSDP variable, tentatively `QUEST_INFO` only if that name is added to `VariableNameTable`, with a documented table/array shape and client fixtures. Broader quest APIs can remain future work.

Evidence:

- The current client already has a `questInfo` field and renderer, but `QUEST_INFO` is not present in the audited Luminari-Source `VariableNameTable`.
- Luminari-Source has quest systems and quest data macros, but no source-backed MSDP quest variable today.
- Command-output parsing would be brittle across wording, color, staff changes, localization, and player state, and would be harder to test than a structured MSDP payload.

Implementation implications:

- Phase 0 should stop requesting `QUEST_INFO` by default unless the user explicitly overrides the mapping.
- Phase 2 should render a deliberate "Quest data is not emitted by this server yet" state.
- Phase 4 should add the smallest structured quest MSDP variable only after source-level fixtures or manual validation exist.

### Terminal Renderer

Decision: prefer xterm.js for long-term terminal fidelity. Keep the current `ansi-to-html` renderer only as an interim renderer through baseline and parser-hardening work. A migration should proceed after a bounded spike proves integration with the current command input, triggers, aliases, scrollback, copy/paste, mobile resizing, and Luminari color handling.

Evidence:

- The current renderer is HTML chunks produced by `ansi-to-html`, with custom scrollback and `dangerouslySetInnerHTML`.
- `mud-web-client` and `lociterm` both use xterm.js for terminal rendering.
- xterm.js is MIT licensed, supports fit and link addons, targets modern evergreen browsers, and is designed as a browser terminal component.

Implementation implications:

- Phase 1 should validate and scope an xterm.js migration rather than leave the terminal decision open-ended.
- The custom renderer remains acceptable only while it passes ANSI, performance, accessibility, copy/paste, and mobile checks.
- If xterm.js migration proceeds, split it into right-sized sessions and keep protocol parsing separate from terminal rendering.

### Production Host and Network Policy

Decision: production proxy deployments must use an allowlist. The default public mode should accept only configured preset host/port pairs, enforce allowed browser origins, reject private/reserved/link-local destinations and banned service ports, and include per-IP rate limiting, maximum connection counts, connect/idle timeouts, and command-log redaction. Custom host/port entry may remain in the UI only when backed by an explicit private/operator deployment flag.

Evidence:

- The current proxy validates host format and port range, but it does not yet enforce host/port allowlists, origin checks, connection quotas, or rate limits.
- `mud-web-proxy` includes allowed origins, allowed hosts, max connections, rate limits, and timeouts.
- `lociterm` documents dedicated-game mode, suggestion controls, banned ports, and protocol checks.
- OWASP SSRF guidance recommends allowlist validation when expected outbound destinations are known.

Implementation implications:

- Add configuration for allowed MUD routes derived from `shared/app-settings.ts` or a server-only environment variable.
- Block direct IP literals in public mode unless explicitly allowlisted.
- Resolve DNS safely and reject loopback, private, link-local, multicast, and metadata-service ranges after resolution.
- Do not log raw player command text by default.
- Serve public deployments over HTTPS/WSS.

### Profiles and Settings

Decision: first release is local-only. Player profiles, cloud sync, shared settings, and account-linked preferences are out of scope until authentication, data retention, deletion, export, and abuse controls are designed. Import/export remains the sync and backup path for aliases, triggers, and preferences.

Evidence:

- The current app persists aliases, triggers, and client settings in browser cookies and supports import/export.
- The PRD already states browser storage must not include passwords or secrets.
- No account system, database, or auth stack exists in this repository.

Implementation implications:

- Keep all first-release settings browser-local and secret-free.
- Prefer migrating settings from cookies to `localStorage` or IndexedDB so preferences are not sent with every HTTP/WebSocket request.
- Do not add user accounts, cloud storage, or shared profile APIs in Phases 0-3.

### License Posture

Decision: preserve the current permissive posture. GPL-3.0 reference repositories may be studied for behavior, UX, protocol edge cases, and test ideas, but their code must not be copied or adapted into this project. If a GPL feature is strongly desired, implement it independently from source facts, public protocol specs, original tests, and clean-room notes. Import GPL code only after an explicit project decision to relicense the affected combined work under GPL-compatible terms.

Evidence:

- This repository is Unlicense.
- `mud-web-client` and `mud-web-proxy` are GPL-3.0.
- FSF GPL guidance treats combining GPL code into a larger distributed program as requiring the combined program to be released under the relevant GPL terms.

Implementation implications:

- Reference repositories can inform behavior and acceptance criteria.
- Keep implementation notes clear when a feature is inspired by a GPL reference.
- Prefer MIT, BSD, Apache, public-domain, or original implementations for runtime dependencies and copied code.

### Browser and Mobile Targets

Decision: first release supports modern evergreen browsers and small-screen mobile web play. Support the latest stable Chrome, Edge, Firefox, and Safari on desktop for browser play. Support current Chrome/Edge/Samsung Internet/Firefox on Android and Safari on iOS for mobile browser play. PWA installability is progressive enhancement: required for Chromium-family desktop/Android and Safari-capable install paths where supported, but not a blocker for Firefox desktop.

Minimum validation targets:

- Desktop: 1280x720 and 1440x900 viewports in latest Chrome/Edge/Firefox/Safari where available.
- Tablet: 768x1024 viewport.
- Mobile: 390x844 viewport as the primary target and 360x800 as a narrow smoke target.
- Network: HTTPS/WSS in production and localhost development.

Evidence:

- The app depends on WebSocket, React, Vite, modern CSS, and future PWA manifest behavior.
- MDN marks WebSocket as widely available across browsers since 2015.
- xterm.js officially targets latest Chrome, Edge, Firefox, and Safari.
- MDN documents PWA install support as varying by browser and platform.

Implementation implications:

- Do not support IE, legacy Android WebView, or non-evergreen desktop browsers.
- Browser play must work even where install prompts are unavailable.
- Mobile acceptance should focus on connect, terminal reading, command input, HUD, sidebar/panels, reconnect messaging, and no horizontal page scroll.

## Research Sources for Resolved Decisions

Local project evidence:

- `README.md`
- `shared/app-settings.ts`
- `shared/mud.ts`
- `server/index.ts`
- `src/App.tsx`
- `src/App.css`
- `LICENSE.md`
- `.spec_system/PRD/PRD.md`

Luminari-Source evidence:

- `/home/aiwithapex/projects/Luminari-Source/src/protocol.c`
- `/home/aiwithapex/projects/Luminari-Source/src/protocol.h`
- `/home/aiwithapex/projects/Luminari-Source/src/comm.c`
- `/home/aiwithapex/projects/Luminari-Source/src/quest.h`
- `/home/aiwithapex/projects/Luminari-Source/src/genqst.c`
- `/home/aiwithapex/projects/Luminari-Source/docs/systems/MSDP_VARIABLES.md`

Reference repository evidence:

- `EXAMPLES/mud-web-client/package.json`
- `EXAMPLES/mud-web-client/LICENSE.md`
- `EXAMPLES/mud-web-client/src/components/MudTerminal.vue`
- `EXAMPLES/mud-web-proxy/src/config.ts`
- `EXAMPLES/mud-web-proxy/src/server.ts`
- `EXAMPLES/mud-web-proxy/src/rate-limiter.ts`
- `EXAMPLES/mud-web-proxy/src/validation.ts`
- `EXAMPLES/mud-web-proxy/LICENSE.md`
- `EXAMPLES/lociterm/README.md`
- `EXAMPLES/lociterm/server/dist.conf`
- `EXAMPLES/lociterm/client/src/manifest.json`
- `EXAMPLES/websockify/README.md`
- `EXAMPLES/wsgate-server/README.md`
- `EXAMPLES/wsgate-server/LICENSE`
- `EXAMPLES/mud-r/README.md`

External sources:

- xterm.js README and API docs: `https://github.com/xtermjs/xterm.js/`, `https://xtermjs.org/docs/api/terminal/classes/terminal/`, `https://xtermjs.org/docs/guides/using-addons/`
- OWASP SSRF guidance: `https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html`, `https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs.html`
- GNU GPL FAQ: `https://www.gnu.org/licenses/gpl-faq.en.html`
- MDN WebSocket and PWA installability docs: `https://developer.mozilla.org/en-US/docs/Web/API/WebSocket`, `https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable`, `https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest`

## Reference Repository Inventory

The active first-party client lives at the project root. The remaining external reference repositories are cloned under `EXAMPLES/`.

| Role                                    | Local path                                                      | Remote                                               | Local branch/commit                |
| --------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------- |
| Luminari server source                  | `/home/aiwithapex/projects/Luminari-Source`                     | `https://github.com/LuminariMUD/Luminari-Source.git` | `master` / `60cbeff6` / 2026-02-22 |
| Active first-party client               | `/home/aiwithapex/projects/luminariweb`                         | `https://github.com/LuminariMUD/luminariweb.git`     | public snapshot / fresh history    |
| Feature/UI reference                    | `/home/aiwithapex/projects/luminariweb/EXAMPLES/mud-web-client` | `https://github.com/maldorne/mud-web-client.git`     | `master` / `012720a` / 2026-04-27  |
| Protocol proxy reference                | `/home/aiwithapex/projects/luminariweb/EXAMPLES/mud-web-proxy`  | `https://github.com/maldorne/mud-web-proxy.git`      | `master` / `03dd743` / 2026-04-27  |
| Mobile/PWA reference                    | `/home/aiwithapex/projects/luminariweb/EXAMPLES/lociterm`       | `https://github.com/RahjIII/lociterm.git`            | `dev` / `6370cd5` / 2026-02-02     |
| Battle-tested bridge fallback           | `/home/aiwithapex/projects/luminariweb/EXAMPLES/websockify`     | `https://github.com/novnc/websockify.git`            | `master` / `a4d6cc5` / 2026-02-11  |
| Single-binary bridge fallback           | `/home/aiwithapex/projects/luminariweb/EXAMPLES/wsgate-server`  | `https://github.com/kazeburo/wsgate-server.git`      | `master` / `71871da` / 2025-05-04  |
| Native WebSocket architecture reference | `/home/aiwithapex/projects/luminariweb/EXAMPLES/mud-r`          | `https://github.com/lpautet/mud-r.git`               | `main` / `3e2e2bd` / 2025-09-29    |

Notes:

- `mud-r` had repo-level activity in 2026, but the cloned default branch currently points at the 2025-09-29 commit above. Use the local commit table when comparing checked-out code.
- The duplicated local checkout of the upstream base has been removed. Baseline verification should run in `/home/aiwithapex/projects/luminariweb`.

## Reference Repository Details

### 1. `GickerLDS/LuminariWebClient`

Use this as the historical upstream base that the project root was derived from. Do not keep a second local checkout under `EXAMPLES/`.

Why:

- Already Luminari/d20MUD specific.
- Already has a React frontend and Node WebSocket-to-Telnet proxy.
- Already parses MSDP and drives HUD/sidebar panels.
- Already has aliases, triggers, command history, settings, import/export, and MUD presets.

Main gaps:

- The terminal is a custom HTML renderer, not xterm.js.
- The client requests some MSDP variables that the audited Luminari source does not currently provide.
- No GMCP, MXP, MCCP decompression, dynamic NAWS resize, mapper, or parser test suite yet.

### 2. `maldorne/mud-web-client`

Use this as the main feature and UI reference.

Why:

- Modern Vite web MUD client.
- Has broad protocol support: MCCP, MXP, MSDP, GMCP/ATCP, 256-color, UTF-8.
- Includes mapper, triggers/macros, command memory, and windowed UI ideas.

Constraint:

- GPL-3.0. Treat it as a reference unless GPL inheritance is intentionally accepted for the first-party client.

### 3. `maldorne/mud-web-proxy`

Use this as the main protocol proxy reference.

Why:

- Purpose-built WebSocket-to-Telnet MUD proxy.
- Pairs with `mud-web-client`.
- Good comparison point for this Node proxy's Telnet negotiation behavior.

Constraint:

- GPL-3.0, same caution as the client.

### 4. `RahjIII/lociterm`

Use this as the mobile/PWA and robust Telnet handling reference.

Why:

- Strong mobile story.
- PWA-first approach.
- C server component uses dedicated Telnet handling libraries.
- Useful model for installable browser play, reconnect behavior, and small-screen ergonomics.

Constraint:

- LGPL-3.0 and a very different stack. It is guidance, not the base.

### 5. `novnc/websockify`

Use this as the proven bridge fallback.

Why:

- Battle-tested WebSocket-to-TCP bridge.
- Good emergency path for a minimal browser connection.
- Useful deployment and reliability reference.

Constraint:

- It does not understand MUD protocols or game state.

### 6. `kazeburo/wsgate-server`

Use this as the lightweight bridge fallback.

Why:

- MIT-licensed.
- Go single-binary WebSocket-to-TCP bridge.
- Useful if the project needs a small bridge separate from the app server.

Constraint:

- Like `websockify`, it is a bridge, not a game-aware client.

### 7. `lpautet/mud-r`

Use this only as a native WebSocket architecture reference.

Why:

- Rust CircleMUD-style server with both Telnet and WebSocket connectivity.
- Good pattern if Luminari-Source later grows a native WebSocket listener.

Constraint:

- Not a drop-in client.
- Luminari-Source should not add native WebSocket first. The proxy is safer until the current C protocol parser is hardened and tested.

## Current Shortlist Metadata

GitHub metadata was checked on 2026-05-10. Local clone state is listed in the Reference Repository Inventory table above.

| Repo                          | Stars | Repo last push | License signal           | Primary role                  |
| ----------------------------- | ----: | -------------- | ------------------------ | ----------------------------- |
| `GickerLDS/LuminariWebClient` |     2 | 2026-05-10     | No assertion             | Historical upstream base      |
| `maldorne/mud-web-client`     |    17 | 2026-04-27     | GPL-3.0                  | Feature/UI reference          |
| `maldorne/mud-web-proxy`      |    12 | 2026-04-27     | GPL-3.0                  | Protocol proxy reference      |
| `RahjIII/lociterm`            |    16 | 2026-02-03     | LGPL-3.0                 | Mobile/PWA reference          |
| `novnc/websockify`            |  4390 | 2026-02-11     | LGPL-3.0                 | Bridge fallback               |
| `kazeburo/wsgate-server`      |    37 | 2025-05-04     | MIT                      | Single-binary bridge fallback |
| `lpautet/mud-r`               |     2 | 2026-04-22     | CircleMUD terms, no SPDX | Native WebSocket reference    |

## Source Locations

- Local source repo: `/home/aiwithapex/projects/Luminari-Source`
- Local first-party client: `/home/aiwithapex/projects/luminariweb`
- Cloned shortlist repos:
  - `/home/aiwithapex/projects/luminariweb/EXAMPLES/mud-web-client`
  - `/home/aiwithapex/projects/luminariweb/EXAMPLES/mud-web-proxy`
  - `/home/aiwithapex/projects/luminariweb/EXAMPLES/lociterm`
  - `/home/aiwithapex/projects/luminariweb/EXAMPLES/websockify`
  - `/home/aiwithapex/projects/luminariweb/EXAMPLES/wsgate-server`
  - `/home/aiwithapex/projects/luminariweb/EXAMPLES/mud-r`
- GitHub remotes:
  - `https://github.com/LuminariMUD/luminariweb`
  - `https://github.com/GickerLDS/LuminariWebClient`
  - `https://github.com/maldorne/mud-web-client`
  - `https://github.com/maldorne/mud-web-proxy`
  - `https://github.com/RahjIII/lociterm`
  - `https://github.com/novnc/websockify`
  - `https://github.com/kazeburo/wsgate-server`
  - `https://github.com/lpautet/mud-r`

## Phases

| Phase | Name                          | Sessions | Status   |
| ----- | ----------------------------- | -------- | -------- |
| 0     | Align With Real Luminari Data | 5        | Complete |
| 1     | Harden Terminal and Proxy     | 6        | Complete |
| 2     | Build Luminari Game Panels    | 6        | Complete |
| 3     | Borrow the Best Ideas         | 6        | Complete |
| 4     | Source-Level Protocol Path    | 5        | Complete |

## Phase 0: Align With Real Luminari Data

Objective: make the current client honest about what Luminari-Source emits today, establish local verification, and create the fixture/test foundation needed for later protocol work.

Status: complete. Phase 00 session 05 closed the local MSDP state-mapping test foundation, and the phase artifacts were archived after validation.

### P0-S1: Baseline Verification and Project Hygiene

Clear objective: establish a trusted baseline for the current app.

Scope:

- Install or verify dependencies.
- Run lint and build.
- Record current failures, warnings, and environment assumptions.
- Fix only blocking hygiene issues that prevent baseline verification.
- Document repeatable local commands for future sessions.

Acceptance:

- `npm run lint` passes or documented failures are converted into actionable follow-up work.
- `npm run build` passes or documented failures are converted into actionable follow-up work.
- The current app can be started in development.
- No feature behavior is changed beyond required baseline fixes.

### P0-S2: MSDP Variable Map Alignment

Clear objective: align requested client variables with confirmed Luminari-Source variables.

Scope:

- Update default MSDP mappings to prioritize confirmed variables.
- Add state fields for `ROOM`, `ROOM_NAME`, `AREA_NAME`, `ROOM_EXITS`, `ROOM_VNUM`, `ACTIONS`, and `INVENTORY`.
- Remove or demote assumptions around `TITLE`, `QUEST_INFO`, saves, `MINIMAP`, and `DAMAGE_BONUS`.
- Preserve user-configurable overrides where they are still useful.

Acceptance:

- Default client requests match confirmed source variables.
- Unsupported values are not presented as guaranteed data.
- Existing settings migration or normalization avoids breaking saved settings.

### P0-S3: Unavailable Data UX

Clear objective: make missing server data clear to players without making the UI feel broken.

Scope:

- Add empty/unavailable states for title, quests, saves, minimap, damage bonus, and other uncertain values.
- Label values that require future server support.
- Avoid visual noise when optional data is absent.
- Keep the terminal-first experience usable without full panel data.

Acceptance:

- Missing optional MSDP data renders as a deliberate empty state.
- The UI distinguishes unavailable data from zero, blank, or loading states.
- No panel depends on unconfirmed data to render successfully.

### P0-S4: MSDP Fixture Corpus

Clear objective: create representative MSDP parser fixtures for confirmed Luminari data shapes.

Scope:

- Collect or synthesize fixtures for scalar values, arrays, tables, nested table data, group data, affects data, inventory data, room data, and malformed payloads.
- Store fixtures in a test-friendly location.
- Document which fixtures are real captures versus constructed examples.
- Include source facts that explain expected parser output.

Acceptance:

- Fixture files are small, readable, and versioned.
- Each fixture has expected parsed output.
- Later parser tests can use the fixtures without live MUD access.

### P0-S5: State Mapping Tests

Clear objective: test mapping from MSDP variable/value pairs into client-visible state.

Scope:

- Add focused tests around MSDP variable normalization.
- Add tests for mapping confirmed variables to `MudState`.
- Add tests for unsupported or unknown variables.
- Add tests for settings overrides.

Acceptance:

- Confirmed variables map to expected client state.
- Unknown variables are ignored safely.
- Unsupported default assumptions are captured by tests.
- Test commands are documented.

## Phase 1: Harden Terminal and Proxy

Status: complete. Phase 01 session 06 closed and the phase artifacts were archived after validation.

Objective: make the proxy and terminal safe under real Telnet traffic, reconnects, malformed data, and deployment pressure.

### P1-S1: Telnet Parser Edge-Case Tests

Clear objective: cover core Telnet parser edge cases before changing parser behavior.

Scope:

- Add tests for split IAC sequences.
- Add tests for doubled IAC bytes.
- Add tests for subnegotiation boundaries.
- Add tests for malformed and partial MSDP payloads.
- Add tests for text flush behavior around control bytes.

Acceptance:

- Parser edge cases are automated.
- Current failures are either fixed in-session or recorded as follow-up defects.
- Tests do not require a live MUD.

### P1-S2: MSDP Tables, Arrays, and Malformed Payloads

Clear objective: harden structured MSDP parsing.

Scope:

- Test arrays, tables, nested values, empty values, and unexpected markers.
- Validate parser output against fixture expectations.
- Ensure malformed payloads do not throw unhandled exceptions.
- Add clear normalization behavior for numeric and string values.

Acceptance:

- Parser handles table and array fixtures correctly.
- Malformed payloads are ignored or partially parsed safely.
- No malformed fixture crashes the proxy.

### P1-S3: Connection Lifecycle and Reconnect Cleanup

Clear objective: make repeated connect/disconnect cycles reliable.

Scope:

- Test browser socket close behavior.
- Test MUD socket close and error behavior.
- Ensure parser, MSDP initialization, state, and socket references reset cleanly.
- Prevent duplicate status events where practical.

Acceptance:

- 25 connect/disconnect cycles pass in automated or scripted testing.
- No stale `MudState` persists after disconnect.
- No duplicate active MUD socket remains after reconnect.

### P1-S4: Dynamic NAWS Resize

Clear objective: send accurate terminal dimensions to the MUD as the browser layout changes.

Scope:

- Add browser-side dimension measurement for the terminal area.
- Send resize messages to the proxy.
- Update proxy NAWS subnegotiation after server support is negotiated.
- Debounce resize traffic.

Acceptance:

- Initial NAWS uses current terminal dimensions rather than fixed defaults.
- Resizing the terminal pane sends updated dimensions.
- Resize behavior is tested or manually verified with logged negotiation output.

### P1-S5: xterm.js Migration Spike

Clear objective: validate and scope the preferred xterm.js migration while keeping the current renderer stable until replacement is ready.

Scope:

- Compare current renderer behavior against needed ANSI, scrollback, copy/paste, keyboard, mobile, accessibility, and performance requirements.
- Build a small xterm.js spike using `@xterm/xterm`, fit behavior, scrollback, and existing command input integration.
- Verify Luminari `^` color handling and server ANSI output remain correct.
- Document migration costs, risks, and right-sized follow-up sessions.
- Keep the custom renderer as an interim fallback until xterm.js passes acceptance checks.

Acceptance:

- xterm.js migration is either approved with a session breakdown or explicitly deferred with blocking evidence.
- Custom renderer gaps are listed if it remains in service after the spike.
- The spike does not mix terminal rendering changes with Telnet parser rewrites.

### P1-S6: Proxy Limits and Deployment Safety

Clear objective: add public-deployment guardrails to the proxy.

Scope:

- Add connection quota rules.
- Add command/input rate limiting.
- Add host/port allowlist or configuration strategy.
- Review logging to avoid command or secret leakage.
- Add health and failure behavior suitable for deployment.

Acceptance:

- Proxy rejects invalid or disallowed connection attempts.
- Rate limits are enforced without breaking normal play.
- Sensitive user command text is not logged by default.
- Deployment safety settings are configurable.

## Phase 2: Build Luminari Game Panels

Objective: turn confirmed Luminari data into useful game UI panels while keeping fallbacks explicit for data that requires future server support.

Status: complete. Phase 02 artifacts were created for six right-sized implementation sessions, and sessions 01 through 06 are complete. The phase was validated and archived after completion.

### P2-S1: Core HUD and Character Panel

Clear objective: make core resource and character data complete and source-aligned.

Scope:

- Render health, PSP, movement, XP/TNL, AC, attack bonus, money, position, level, race, and class.
- Normalize numeric values consistently.
- Add unavailable states for non-emitted fields.
- Improve compact display behavior for small viewports.

Acceptance:

- Confirmed character/resource fields render from MSDP state.
- Optional fields fail gracefully.
- HUD remains readable at desktop and 390px mobile width.

Status: complete. Session 01 was validated and marked complete on 2026-05-11.

### P2-S2: Combat and Action Economy Panel

Clear objective: expose opponent, tank, and action state in combat.

Scope:

- Render opponent and tank names and health.
- Parse and display `ACTIONS` once payload shape is confirmed.
- Avoid relying on `DAMAGE_BONUS` until confirmed live.
- Keep combat state distinct from general character state.

Acceptance:

- Combat state updates without full page or panel resets.
- Empty combat state is visually quiet.
- `ACTIONS` rendering is covered by fixture or mapping tests.

Status: complete. Session 02 was validated and marked complete on 2026-05-11.

### P2-S3: Group Panel

Clear objective: make `GROUP` useful for party play.

Scope:

- Parse known `GROUP` payload shapes.
- Render member names, leader marker, health, movement, and relevant status values.
- Handle missing per-member fields.
- Add tests or fixtures for group payloads.

Acceptance:

- Group data renders consistently across expected payload variants.
- Missing values do not break row layout.
- Group rendering can be validated without live MUD access.

Status: complete. Session 03 was validated and marked complete on 2026-05-11.

### P2-S4: Affects and Inventory Panels

Clear objective: render temporary effects and inventory data from structured MSDP values.

Scope:

- Normalize `AFFECTS` table/array payloads.
- Render affects with names, durations, modifiers, or raw fallback fields as available.
- Normalize `INVENTORY` once payload shape is confirmed.
- Render inventory with useful grouping or fallback raw structure.

Acceptance:

- Affects and inventory panels handle empty, list, and table data.
- Unknown fields are visible enough for debugging without overwhelming players.
- Fixtures cover representative payloads.

Status: complete. Session 04 was validated and marked complete on 2026-05-11.

### P2-S5: Room Context Panel

Clear objective: show current room identity and exits using confirmed room variables.

Scope:

- Request and map `ROOM`, `ROOM_NAME`, `AREA_NAME`, `ROOM_EXITS`, and `ROOM_VNUM`.
- Render room name, area, vnum when available, and exits.
- Preserve terminal room text as the primary descriptive source.
- Add raw/debug fallback for uncertain room payload shapes.

Acceptance:

- Room panel updates when room MSDP values change.
- Exit display handles strings, arrays, and table-like structures as needed.
- Room context does not depend on `MINIMAP`.

Status: complete. Session 05 was validated and marked complete on 2026-05-11.

### P2-S6: Map and Quest Fallback Strategy

Clear objective: implement the first usable map behavior and make quest data explicitly unavailable until a structured server variable exists.

Scope:

- Build a minimal room/exits map from confirmed room variables.
- Use `MINIMAP` only if live population is confirmed.
- Do not parse free-form quest command output.
- Keep the quest panel as an unavailable or optional-data state unless a structured quest MSDP variable is present.
- Record the selected structured quest MSDP work for Phase 4.

Acceptance:

- Map panel has a useful first version based on reliable data.
- Quest panel states clearly that quest data is unavailable unless the server emits structured quest data.
- Any required source-level quest work is recorded for Phase 4.

## Phase 3: Borrow the Best Ideas

Objective: add high-value UI, automation, mobile, and deployment ideas from the shortlist while respecting license and stack boundaries.

### P3-S1: Mapper UX Reference Implementation

Clear objective: evolve the minimal room map toward a better mapper using reference behavior, not copied GPL code.

Scope:

- Study mapper behavior from `mud-web-client`.
- Define a Luminari-safe mapper data model.
- Add current-room highlighting and directional expansion.
- Preserve simple fallback when room metadata is incomplete.

Acceptance:

- Mapper behavior is implemented from original code.
- License-sensitive references are documented as behavioral inspiration only.
- Mapper remains useful with only room and exit data.

### P3-S2: Windows and Layout Ergonomics

Clear objective: improve multi-panel organization without weakening the terminal-first workflow.

Completed: 2026-05-11.

Scope:

- Study window/sidebar ideas from `mud-web-client`.
- Improve panel switching, density, and persistence.
- Avoid nested card-heavy layouts.
- Ensure keyboard and mobile interaction remain usable.

Acceptance:

- Players can move between terminal, HUD, panels, and map efficiently.
- Layout does not obscure command input.
- Mobile and desktop screenshots pass visual sanity checks.

### P3-S3: Alias, Macro, and Trigger UX

Clear objective: make automation features easier and safer to manage.

Scope:

- Review existing alias/trigger implementation.
- Add validation, preview, enable/disable, import/export, and error feedback improvements.
- Prevent runaway recursion and noisy trigger loops.
- Improve persistence behavior.

Acceptance:

- Users can safely create, test, disable, import, and export automation.
- Recursive expansion limits are visible and enforced.
- Automation failures do not break the connection.

### P3-S4: Mobile and PWA Foundation

Clear objective: bring in the best mobile lessons from `lociterm`.

Scope:

- Add or improve responsive command input behavior.
- Improve reconnect and offline/online messaging.
- Add manifest/icons/service-worker basics only where they improve installability without blocking browser play.
- Test small-screen ergonomics at 390px and 360px widths.

Acceptance:

- Connect, command input, terminal, and core HUD work at 390px width.
- PWA metadata and install behavior are present where supported or explicitly deferred with browser-specific limits.
- Reconnect messaging is clear on mobile.
- Browser play works even where install prompts are unavailable.

### P3-S5: Bridge Deployment Options

Clear objective: define production proxy policy and decide whether the app should support bridge isolation patterns.

Scope:

- Study `websockify` and `wsgate-server` deployment models.
- Compare integrated proxy versus standalone bridge operation.
- Document production topology options and default to an allowlisted integrated proxy unless isolation is required.
- Add or plan host/port allowlist, allowed origins, banned ports, rate limits, connection limits, connect/idle timeouts, and command-log redaction.
- Implement only low-risk configuration changes if they fit the session.

Acceptance:

- Deployment options are documented with tradeoffs.
- Public production mode rejects arbitrary host/port targets by default.
- Any chosen bridge fallback has a clear operational path.
- No game-aware behavior is moved into a blind bridge.

### P3-S6: Protocol Feature Checklist

Clear objective: create a living checklist for supported, rejected, and deferred protocol features.

Scope:

- Inventory ANSI, 256-color, UTF-8, TTYPE, NAWS, MSDP, GMCP, MXP, MSP, MCCP, MSSP, and CHARSET behavior.
- Mark each feature as supported, rejected, partial, or deferred.
- Link each status to tests or source facts.
- Expose only user-relevant protocol status in the UI if useful.

Acceptance:

- Maintainers can see what protocol features are safe to build on.
- Deferred protocol work has reasons and prerequisites.
- The checklist prevents accidental MCCP or GMCP overcommitment.

Status: complete. Phase 03 session 06 closed the protocol feature checklist and the phase artifacts were archived after validation.

## Phase 4: Source-Level Protocol Path

Objective: define and implement only the source-level protocol changes that are justified after the webclient and proxy are stable.

Status: complete. Phase 04 session 05 closed native WebSocket feasibility, the current proxy remained the supported production path, and the phase artifacts were archived after validation.

### P4-S1: Luminari-Source Protocol TODO Audit

Clear objective: convert source protocol TODOs into a ranked implementation backlog.

Scope:

- Re-read `protocol.c`, `protocol.h`, `comm.c`, and protocol docs.
- Compare TODOs with client needs from previous phases.
- Rank source changes by player value, risk, and testability.
- Identify changes that should not be attempted yet.

Acceptance:

- Source-level backlog is ranked.
- Each item has a rationale and risk note.
- Webclient-only alternatives are listed where source changes are unnecessary.

### P4-S2: Protocol Parser Test Harness

Clear objective: add or improve Luminari-Source protocol tests before changing protocol behavior.

Scope:

- Identify the best local test strategy for C protocol code.
- Add focused tests for protocol input/output where feasible.
- Prepare fixtures for MSDP, GMCP, MCCP, MXP, NAWS, and malformed input.
- Avoid broad parser rewrites before tests exist.

Acceptance:

- At least the highest-risk protocol paths have automated or scripted validation.
- Tests can run locally with documented commands.
- Future protocol changes have a safety net.

### P4-S3: Missing MSDP Variables

Clear objective: add only server variables that are proven useful, low risk, and backed by client needs.

Scope:

- Add structured quest data as the preferred quest path if the payload shape is approved.
- Decide whether to add `TITLE`, saves, minimap population, or other missing values.
- Implement the smallest source changes needed for selected variables.
- Update server docs and client mappings.
- Add tests or manual validation notes.

Acceptance:

- Selected variables are emitted by Luminari-Source and consumed by the client.
- Unselected variables remain documented as deferred or rejected.
- Client fallbacks still work when connected to older servers.
- Quest support uses structured server data, not free-form command-output scraping.

### P4-S4: MCCP and GMCP Decision

Clear objective: decide whether MCCP and GMCP should become real supported features.

Scope:

- Evaluate real MCCP implementation versus disabling stubbed paths.
- Evaluate GMCP module API needs and compatibility.
- Define server and proxy changes for each option.
- Implement only if scope fits a right-sized session; otherwise produce follow-up specs.

Acceptance:

- MCCP status is no longer ambiguous.
- GMCP direction is documented.
- Any implementation is covered by tests or explicit validation steps.

### P4-S5: Native WebSocket Feasibility

Clear objective: decide whether Luminari-Source should eventually expose native WebSocket support.

Scope:

- Study `mud-r` architecture as a reference.
- Compare native WebSocket with the current proxy model.
- Identify security, operations, and protocol-parser implications.
- Recommend pursue, defer, or reject.

Acceptance:

- Native WebSocket decision is documented.
- If pursued, the work is split into future phases and sessions.
- The current proxy remains the supported production path until replacement is proven.

## Cross-Phase Quality Gates

Each phase should satisfy these gates before it is considered complete:

- `npm run lint` passes.
- `npm run build` passes.
- New parser, mapping, or proxy behavior has automated tests where practical.
- Manual smoke testing covers connect, command input, terminal output, MSDP state updates, disconnect, and reconnect.
- Mobile smoke testing covers at least a 390px viewport.
- Narrow mobile smoke testing covers a 360px viewport when UI changed.
- Public proxy changes preserve allowlisted destination enforcement and avoid raw command logging.
- License-sensitive references are documented as behavioral inspiration, not copied code.
- Open risks and deferred items are captured before the next phase starts.

## Success Criteria

- [x] The default MSDP map matches confirmed Luminari-Source variables.
- [x] Unsupported or missing data renders with deliberate fallback states.
- [x] Parser tests cover core Telnet and MSDP edge cases.
- [x] Reconnect behavior passes repeated-cycle testing.
- [x] HUD, character, combat, group, affects, inventory, room, and map panels render useful Luminari data.
- [x] Mobile users can connect, read, type, and inspect core state at 390px width.
- [x] Narrow mobile smoke testing passes at 360px width for core connect, terminal, and command input workflows.
- [x] Proxy safety controls are in place before public deployment.
- [x] Public proxy mode rejects non-allowlisted host/port targets.
- [x] Quest panel uses unavailable-state behavior until structured server-emitted quest data exists.
- [x] Protocol support status is documented and test-linked.
- [x] Source-level changes are deferred until the proxy client is stable and test coverage exists.

## Risks and Mitigations

- **Server/client data mismatch**: Keep defaults aligned with audited variables and use explicit unavailable states.
- **Protocol parser regressions**: Add fixtures and tests before changing parser behavior.
- **Licensing contamination**: Treat GPL repositories as behavioral references only unless licensing strategy changes.
- **MCCP ambiguity**: Keep rejecting MCCP until both server and proxy have real, tested compression behavior.
- **Over-large sessions**: Split each phase into one-objective sessions with 12-25 tasks before coding.
- **Mobile complexity**: Validate core workflows at small widths in each UI-heavy phase.
- **Source-level blast radius**: Make server changes only after client/proxy stability and test harnesses exist.
- **SSRF and open proxy risk**: Use allowlisted production destinations, banned ports, DNS/IP safety checks, origin checks, quotas, and rate limits.
- **Quest display drift**: Avoid command-output scraping and use structured MSDP data with fixtures.
- **Settings privacy drift**: Keep first-release settings local-only and secret-free; do not add cloud sync without an auth/privacy plan.

## Assumptions

- Luminari-Source remains the authoritative source for protocol capabilities.
- The current React/Node architecture remains the primary product path through Phase 3.
- Local example repositories remain available under `EXAMPLES/` for reference.
- Live MUD access or representative payload captures will be available before finalizing data-heavy panels.
- The project prefers permissive implementation over importing GPL-licensed code.
- First release supports curated LuminariMUD-compatible presets, not arbitrary public MUD routing.
- First release has no accounts, cloud profiles, shared settings, or server-side preference storage.
- xterm.js is the preferred long-term terminal renderer if the migration spike passes integration checks.
- Browser support targets modern evergreen desktop browsers and current Android/iOS mobile browsers.
