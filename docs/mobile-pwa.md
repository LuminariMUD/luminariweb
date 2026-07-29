# Mobile and PWA Notes

Luminari Web remains an online browser client. The PWA foundation improves installability and app-shell resilience, but MUD play still requires a live browser network, WebSocket proxy, and Telnet route to the selected game.

## Mobile Behavior

The mobile layout keeps the terminal-first workflow:

- The terminal output remains scrollable and bounded on narrow screens.
- The command input stays visible below terminal output and HUD bars.
- The mobile status strip shows browser network state, proxy readiness, and MUD connection state separately.
- Command history has touch controls for previous and next history entries.
- Connect and reconnect controls are disabled while a connection attempt is already in flight.
- Inspector tabs use short labels at narrow widths and panel content wraps or scrolls locally.

Browser offline state is a local signal only. It does not prove the remote MUD or proxy is reachable, and it does not enable offline play.

## Installability Limits

Browsers expose PWA install prompts differently. A prompt may be unavailable when:

- The page is not served from HTTPS or a localhost secure context.
- The browser does not support installable web apps.
- The browser requires additional icon or engagement criteria.
- The user has dismissed or disabled install prompts.
- The app is opened inside an embedded or restricted browser view.

When install prompts are unavailable, the normal browser client should still load and play online.

## Manifest

`public/manifest.webmanifest` declares:

- Same-origin `id`, `start_url`, and `scope`.
- `standalone` display with browser fallback.
- Theme and background colors.
- Game and utility categories.
- Existing SVG icon references.

No binary icon generation is required for this session.

## Service Worker Policy

`public/service-worker.js` uses a conservative static shell cache. It is network-first for safe static files and falls back to cache only for those same static files.

Allowed cache examples:

- `/`
- `/index.html`
- `/manifest.webmanifest`
- `/favicon.svg`
- `/icons.svg`
- Vite-built `/assets/*.js` and `/assets/*.css`

Never cached:

- `/api/` routes, including `/api/settings`
- `/ws`
- WebSocket upgrade requests
- Non-`GET` requests
- Cross-origin requests
- Player commands
- Command history
- Terminal transcripts
- MSDP payloads
- Passwords, tokens, or host secrets

The service worker must not queue commands, replay input, or claim offline gameplay support.

## Startup Behavior

`src/main.tsx` registers the service worker only when:

- `navigator.serviceWorker` exists.
- The current context is secure.
- Registration completes before the timeout.

Unsupported browsers and registration failures are logged to the console and must not block React startup.

## Manual Smoke Checks

Use a local dev or preview server and check desktop, 390px, and 360px widths.

Desktop:

- Load the app and verify the header status row shows browser, proxy, and MUD state.
- Connect and disconnect through the connection form.
- Confirm terminal output, HUD bars, inspector tabs, and command input match the existing workflow.
- Open Aliases, Triggers, MSDP Vars, and Settings menus and verify they wrap without covering command input.

390px:

- Verify there is no horizontal page scrolling.
- Verify the mobile status strip is readable.
- Connect, disconnect, and reconnect without duplicate in-flight connection attempts.
- Send a normal command while connected.
- Use previous and next command history controls.
- Open each inspector tab: Map, Room, Character, Combat, Group, Inventory, Affects, and Quests.
- Open automation menus and confirm controls wrap inside the viewport.

360px:

- Repeat the 390px checks as a smoke pass.
- Verify long room names, exits, group members, affects, inventory names, quest payloads, status details, and automation errors wrap or scroll inside their local panels.
- Verify the command dock remains reachable with the on-screen keyboard open.

Online/offline:

- Toggle the browser offline and confirm the status strip says browser offline.
- Confirm Send and reconnect controls do not imply offline play.
- Return online and verify the status updates without reloading.

Service worker:

- In a supported secure context, confirm registration does not crash startup.
- Inspect browser application storage and verify only static shell entries are cached.
- Confirm `/api/settings` and `/ws` requests are not cached.

## Reference Boundary

`EXAMPLES/lociterm` was used only as behavior-level input for mobile-first play, installability expectations, touch controls, local browser settings, and status visibility. No reference source code, CSS, prose, images, screenshots, or assets were copied.
