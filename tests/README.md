# Tests

Run focused TypeScript tests with:

```sh
npm test
```

The test script uses Node's built-in `node:test` runner with the existing `tsx` loader:

```sh
node --import tsx --test tests/*.test.ts
```

## Current Scope

- MSDP variable-map normalization.
- Configured outbound MSDP request filtering.
- Pure MSDP variable/value mapping into `MudState` partials.
- Fixture-driven state-mapping coverage from `tests/fixtures/msdp/manifest.json`.
- Fixture-driven parser coverage for MSDP scalars, arrays, tables, nested structures,
  mixed array/table payloads, empty collections, malformed payloads, and parser-to-state
  mapping compatibility.
- Side-effect-free Telnet parser edge-case coverage for split IAC sequences, doubled IAC bytes,
  negotiation boundaries, MSDP subnegotiation boundaries, malformed MSDP input, TTYPE, and NAWS.
- Proxy lifecycle coverage for manual disconnect, browser close cleanup, MUD socket close/error
  cleanup, reconnect state reset, stale socket callback suppression, active WebSocket connection
  accounting, terminal resize routing, NAWS reconnect scoping, and 25 repeated connect/disconnect
  cycles.
- Proxy safety coverage for banned service ports, unsafe IPv4/IPv6 ranges, IPv4-mapped IPv6
  addresses, metadata-service targets, public allowlists, explicit custom routing, WebSocket origin
  policy, DNS failure handling, unsafe DNS answers, connect timeouts, idle timeouts, stale timeout
  callbacks, manual timeout/disconnect races, and command-redaction assertions.
- Deployment-policy coverage for public-mode default destination rejection, configured allowlist
  acceptance, missing and unexpected origin rejection, banned ports, unsafe network blocking, custom
  routing safety, timeout clamping, and sanitized policy details.
- Dynamic NAWS resize coverage for default dimensions, custom initial dimensions, changed
  dimensions, no unsupported-before-negotiation writes, resize before connect, resize before NAWS
  negotiation, resize after disconnect, and resize after reconnect.
- Terminal renderer coverage for escaped HTML output, literal angle brackets, ANSI color conversion,
  Luminari caret/RGB color conversion, reset handling, and streaming output.
- xterm spike helper coverage for query-parameter fallback, option defaults, accessibility settings,
  scrollback, and bounded fit dimensions.
- Core MSDP display helper coverage for HUD bars, XP/TNL progress, character stats, source-backed
  saves, zero values, negative values, missing max values, unavailable fields, and override-only
  waiting states.
- Combat display helper coverage for opponent and tank status, zero and partial health values,
  quiet inactive states, `ACTIONS` arrays and fallback payloads, and override-only damage bonus
  availability.
- Group display helper coverage for full and partial members, missing names, zero values, movement
  maximums, leader flags, status text, unknown fields, object-like payloads, raw fallback entries,
  disabled mappings, and connection availability states.
- Affects and inventory display helper coverage for full and partial effects, zero and negative
  durations, modifiers, grouped and counted inventory, item locations, long names, unknown fields,
  raw fallback entries, disabled mappings, and connection availability states.
- Room display helper coverage for full and partial identity, zero room vnum, blank fields,
  structured `ROOM` fallback, string/array/table/object-like exits, deterministic ordering,
  unknown fields, raw fallback entries, disabled mappings, and connection availability states.
- Map display helper coverage for fallback room/exits summaries, current-room mapper nodes,
  deterministic directional branch placement, raw malformed exit fallback, source-backed live
  `MINIMAP`, disabled mappings, loading, empty, offline, and error states.
- Quest display helper coverage for default unavailable `QUEST_INFO`, configured waiting, empty,
  structured override, scalar override, offline, and error states without free-form quest parsing.
- Layout preference helper coverage for default inspector state, valid saved payloads, corrupt JSON,
  unknown tab ids, invalid density values, missing fields, future versions, and storage-safe
  serialization.
- Protocol feature status coverage for required feature inventory, evidence presence, status counts,
  deterministic grouping, deferred Phase 04 tags, and conservative MCCP/GMCP claims.
- Automation helper coverage for alias and trigger validation, wildcard captures, command sequence
  splitting, disabled entries, previews, alias recursion reports, and trigger command caps.
- Client config persistence coverage for versioned localStorage payloads, corrupt and future-version
  fallbacks, full import normalization, partial alias/trigger imports, legacy cookie migration
  inputs, and malformed import preservation.

These tests import shared pure helpers directly from `shared/mud.ts`, `shared/msdp-state.ts`,
`server/telnet-parser.ts`, and side-effect-free lifecycle modules such as
`server/mud-session.ts` and `server/connection-accounting.ts`. They do not import
`server/index.ts`, start Express, open WebSocket listeners, connect TCP sockets, launch a browser,
or require live MUD access.

## Fixture Use

Fixture-driven tests load `tests/fixtures/msdp/manifest.json` first and then read each listed fixture file. The helper validates manifest counts, sanitized fixture metadata, expected pair tuple shapes, and recursive `MudValue` payload shapes before mapping expected pairs.

Parser fixture tests encode each fixture `payloadTokens` stream into raw MSDP bytes before
calling `parseMsdpPayload()`. Expected parser output is compared directly with fixture
`expectedPairs`, and malformed fixture payloads are expected to produce safe partial output
or empty values without throwing.

The fixture corpus is synthetic in the current manifest and must remain free of passwords, tokens, private commands, host secrets, and private live session data.

Lifecycle tests use `tests/helpers/proxy-lifecycle-harness.ts` to inject fake browser and MUD
sockets. Fake socket payloads must stay synthetic and must not include passwords, tokens, private
commands, private hosts, or captured live player transcripts.

Proxy policy tests use injected DNS lookup functions and fake timers. They do not perform real DNS
lookups, open TCP sockets, or require a live MUD. Focused commands:

```sh
node --import tsx --test tests/msdp-display.test.ts
node --import tsx --test tests/msdp-group-display.test.ts
node --import tsx --test tests/msdp-affects-inventory-display.test.ts
node --import tsx --test tests/msdp-room-display.test.ts
node --import tsx --test tests/msdp-map-display.test.ts
node --import tsx --test tests/msdp-quest-display.test.ts
node --import tsx --test tests/client-layout-preferences.test.ts
node --import tsx --test tests/protocol-feature-status.test.ts
node --import tsx --test tests/msdp-state-mapping.test.ts
node --import tsx --test tests/proxy-network.test.ts
node --import tsx --test tests/proxy-policy.test.ts
node --import tsx --test tests/proxy-deployment-policy.test.ts
node --import tsx --test tests/proxy-lifecycle.test.ts
node --import tsx --test tests/client-automation.test.ts
node --import tsx --test tests/client-config-persistence.test.ts
node --import tsx --test tests/pwa-support.test.ts
```

## Mobile and PWA Helper Tests

Run the focused PWA helper tests with:

```sh
node --import tsx --test tests/pwa-support.test.ts
```

These tests cover browser online/offline labels, proxy and MUD status decisions, reconnect
eligibility, service-worker support fallbacks, registration error messages, same-origin static
asset cache eligibility, and exclusions for `/api/settings`, `/ws`, non-GET, WebSocket upgrade,
cross-origin, and non-static requests.

## Manual Automation Notes

When doing manual automation checks, start the local app, open the client in a desktop browser, and
use the Aliases, Triggers, and Settings menus without needing live MUD access for preview/import
checks.

- Create a valid alias such as `k * -> kill %1`, preview `k goblin`, send it while connected, and
  verify command history records only the typed command.
- Create invalid aliases and triggers with empty fields or unmatched captures such as `%2`; verify
  inline errors appear and saving a config is refused until fixed.
- Create a valid trigger such as `* tells you * -> tell %1 I heard %2`, preview a sample line, and
  verify no WebSocket command is sent by preview controls.
- Disable an alias or trigger and verify previews or real dispatch ignore disabled entries.
- Delete an alias or trigger and verify the confirmation row supports both confirm and cancel.
- Import malformed full configs and malformed partial alias/trigger files; verify existing settings,
  aliases, and triggers remain unchanged.
- Export a config and verify it contains only settings, aliases, triggers, type, and version fields;
  it must not include passwords, host secrets, command history, or terminal transcript text.
- Simulate legacy `lwc.settings`, `lwc.aliases`, and `lwc.triggers` cookies, reload, verify
  `localStorage.lwc.config` is populated, and verify only successfully migrated cookie groups are
  cleared.
- At desktop, 390px, and 360px widths, verify validation errors, preview output, loop notices,
  confirmation rows, and Settings import/export controls wrap without horizontal page scrolling or
  covering the command input.

## Manual Resize Notes

The automated NAWS tests do not require a live MUD server or browser. When doing manual UI checks,
start the local app, open the client in a desktop browser, connect to an available MUD route, resize
the terminal pane or browser window, and verify command input focus, auto-scroll, aliases, triggers,
and terminal rendering still behave normally.

For core HUD and character panel checks, use desktop, 390px, and 360px viewports. Verify there is no
horizontal page scrolling, the command dock remains usable, HP/PSP/movement/XP bars show visible
text, character stats wrap inside the sidebar, selected title/save and deferred damage states remain
explicit, and terminal resize updates do not visibly interrupt input.

For combat panel checks, use desktop, 390px, and 360px viewports. Verify inactive combat stays quiet,
opponent-only, tank-only, opponent+tank, empty actions, mixed action entries, and damage-bonus
availability states remain readable, the Combat tab wraps without horizontal page scrolling, and
command input focus returns normally after selecting the combat tab.

For group panel checks, use desktop, 390px, and 360px viewports. Verify waiting, empty, full, partial,
long-name, leader, status, health, movement, raw fallback, and unknown-field states remain readable,
resource text stays visible with or without maximum values, the Group tab wraps without horizontal
page scrolling, and command input focus returns normally after selecting the group tab.

`GROUP` fixtures are synthetic display and parser contracts for a source-confirmed MSDP variable.
They should not be treated as proof of final live server member field names until source-level
protocol work confirms the member schema.

For affects and inventory panel checks, use desktop, 390px, and 360px viewports. Verify waiting,
empty, full, partial, grouped, counted, long-name, raw fallback, unknown-field, disabled, offline,
and error states remain readable, collection row text wraps inside the sidebar, the Inventory and
Affects tabs wrap without horizontal page scrolling, and command input focus returns normally after
selecting either tab.

`AFFECTS` and `INVENTORY` fixtures are synthetic display and parser contracts for source-confirmed
MSDP variables. They should not be treated as proof of final live server affect or inventory field
names until source-level protocol work confirms those schemas.

For room panel checks, use desktop, 390px, and 360px viewports. Verify waiting, empty, full,
partial, table, array, string, long-name, disabled, offline, error, raw fallback, and unknown-field
states remain readable, room fields and exit rows wrap inside the sidebar, the Room tab wraps
without horizontal page scrolling, the existing map fallback still works when `MINIMAP` is absent,
and command input focus returns normally after selecting the Room tab.

`ROOM` and `ROOM_EXITS` fixtures are synthetic display and parser contracts for source-confirmed
MSDP variables. They should not be treated as proof of final live server room or exit field names,
and the Room tab must remain separate from empty or missing `MINIMAP` behavior.

For map and quest panel checks, use desktop, 390px, and 360px viewports. Verify map loading, empty,
disabled, offline, error, room/exits fallback, and source-backed live `MINIMAP` states remain
readable without horizontal page scrolling. For room/exits fallback, verify the compact mapper keeps
the current-room node highlighted, compass exits placed around it, vertical/custom exits listed
below it, raw malformed exits preserved as fallback text, and the command input unobstructed. Verify
the Quests tab states that default
Luminari-Source structured quest data is unavailable, configured `QUEST_INFO` override payloads
render inside the tab, large payloads scroll inside the panel, and command input focus returns
normally after selecting the Quests tab.

`QUEST_INFO` remains override-only until source-level protocol work confirms live population and a
fixture-backed schema.

For inspector layout checks, use desktop, 390px, and 360px viewports. Verify the Map, Room,
Character, Combat, Group, Inventory, Affects, Quests, and Protocol tabs are reachable from one
inspector, the active tab, collapsed state, and density restore after refresh, corrupt `lwc.layout`
`localStorage` falls back to the Map tab without breaking startup, and the command input remains
visible before and after tab switches, collapse/expand, density changes, settings menu close, and
terminal clicks. At 390px and 360px, verify there is no horizontal page scrolling, short tab labels
fit inside the inspector, long panel fallback text wraps or scrolls inside the panel, and the command
form remains reachable without being covered by the inspector.

For Protocol tab checks, verify status counts, status badges, evidence links, Phase 04 follow-up
labels, and long support-boundary notes wrap inside the panel at desktop, 390px, and 360px widths.
Confirm MCCP, GMCP, MXP, MSP, MSSP, CHARSET, `QUEST_INFO`, and live `DAMAGE_BONUS` are not
presented as complete live support.

For mobile/PWA checks, use desktop, 390px, and 360px viewports. Verify the header and mobile status
strip distinguish browser network, proxy readiness, and MUD connection state. Toggle browser
offline/online and verify reconnect and Send do not imply offline play. Connect, disconnect, and
reconnect without duplicate in-flight connection attempts. Send a normal command while connected,
then use the touch previous and next history controls. Open Aliases, Triggers, MSDP Vars, and
Settings menus and verify validation messages, preview output, import/export controls, and long
text wrap without horizontal page scrolling. In a supported secure context, verify service-worker
registration does not crash startup and cached entries are limited to static shell files; `/api/settings`
and `/ws` must not be cached.

## Manual Public-Mode Smoke Checks

These checks do not require live production credentials. Use them when changing
deployment policy, reverse-proxy configuration, or bridge fallback docs.

- Run `node --import tsx --test tests/proxy-deployment-policy.test.ts`.
- Start a local production build with `npm run build && npm start`.
- Confirm `curl -fsS http://localhost:${PORT:-5191}/health` returns success.
- In a public-mode environment, confirm the deployed HTTPS origin is present in
  `PROXY_ALLOWED_ORIGINS`.
- Confirm a curated preset or server-only `PROXY_ALLOWED_DESTINATIONS` route can
  attempt a connection, and an arbitrary unlisted public hostname is rejected.
- Confirm a banned service port, private address, loopback address,
  link-local address, reserved address, or metadata-service target is rejected.
- Confirm an unexpected WebSocket origin is rejected before any MUD connection
  attempt.
- Confirm bridge recording, TCP dump, packet capture, and verbose byte logging
  are not enabled for player traffic.
- Confirm no support artifact includes player command text, credentials typed
  inside the MUD, private hostnames, or terminal transcripts by default.

## Manual Renderer Notes

The xterm.js renderer is an opt-in spike, not the default terminal path. Start the app and compare:

```sh
npm run dev
```

- Default renderer: open the app without query parameters and verify escaped text, ANSI output,
  command input focus, history, aliases, triggers, movement shortcuts, selection/copy, auto-scroll,
  reconnect reset, and resize behavior.
- xterm spike: open the app with `?terminalRenderer=xterm-spike` and repeat the same checks.
- Invalid mode fallback: open the app with `?terminalRenderer=invalid` and verify the default HTML
  renderer remains active.

## Deferred Coverage

Browser-level visual regression automation remains outside this test suite. Public infrastructure
layers such as CDN, WAF, TLS termination, host firewalling, and cloud deployment health checks are
deployment responsibilities and are not exercised by these Node tests.
