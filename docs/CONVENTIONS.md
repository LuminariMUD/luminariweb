# CONVENTIONS.md

## Guiding Principles

- Optimize for readable, boring code over clever abstractions.
- Keep behavior aligned with the current architecture, protocol checklist, and
  historical requirements in `docs/prev_prd/PRD.md`.
- Treat Luminari-Source as the authority for emitted protocol data.
- Validate parser, proxy, and state-mapping changes with fixtures or tests where practical.
- Use ASCII-only text and LF line endings in spec-system files.

## Tech Stack

- Frontend: React 19, TypeScript, Vite, CSS.
- Proxy/server: Node.js, Express, `ws`, native `net` sockets.
- Shared code: TypeScript modules under `shared/`.
- Quality gates: `npm run lint` and `npm run build`.
- Tests: not configured yet; add focused tests before protocol-heavy changes.

## Naming

- Use `camelCase` for variables, functions, hooks, and object fields.
- Use `PascalCase` for React components and TypeScript types/interfaces.
- Use `UPPER_SNAKE_CASE` for module constants.
- Use domain terms consistently: MSDP, Telnet, MUD, room, affects, group, proxy.
- Keep protocol variable names exact when referring to server values such as `ROOM_EXITS`.

## TypeScript

- Prefer explicit exported types for shared protocol contracts and WebSocket messages.
- Keep `MudState`, MSDP mappings, and client/server message shapes in shared modules when both sides need them.
- Avoid `any`; use narrow unions, records, and type guards for protocol input.
- Normalize untrusted browser and Telnet input before it reaches UI state.
- Respect the repo TypeScript settings: no unused locals, no unused parameters, and no fallthrough cases.
- Keep runtime settings typed through `AppSettings` and `MudPreset`.

## React

- Use function components and hooks.
- Keep derived display state in `useMemo` when it prevents repeated parsing or formatting.
- Keep callbacks stable with `useCallback` when passed into deep UI or effect dependencies.
- Represent unavailable server data distinctly from zero, empty, loading, and parse failure.
- Avoid panel behavior that blocks terminal reading or command input.
- Render MUD/ANSI text through `renderMudHtml` or the configured ANSI converter; do not introduce raw HTML paths without XML escaping.
- Preserve command-input focus behavior when changing menus, panels, or terminal click handling.

## Server and Proxy

- Treat browser WebSocket messages as untrusted input and validate shape, host, port, and text before use.
- Keep Telnet parser state isolated per MUD session.
- Reset socket, parser, MSDP initialization, and `MudState` on disconnect/reconnect.
- Do not log player command text by default.
- Keep host/port allowlist, quota, and rate-limit work explicit before public deployment.
- Keep `/health`, `/api/settings`, and `/ws` stable unless documentation and client code are updated in the same change.

## Protocol Handling

- Do not assume a variable exists unless it is confirmed in Luminari-Source or captured live.
- Keep MCCP rejected until both server compression and proxy decompression are real and tested.
- Treat GMCP, MXP, MSP, CHARSET, TTYPE, NAWS, and MSSP as feature-specific work with tests or documented validation.
- Preserve doubled IAC handling, split IAC handling, and subnegotiation boundaries when changing parser code.
- Add fixtures for scalar, table, array, malformed, and reconnect-sensitive payloads.

## Files and Structure

- Use `src/` for browser UI, `server/` for proxy/server code, and `shared/` for cross-runtime types and helpers.
- Keep feature state and rendering close together until duplication or risk justifies extraction.
- Keep protocol parsing and protocol mapping separate where practical.
- Do not copy code from GPL reference repositories unless the licensing posture changes.
- Keep `EXAMPLES/` as reference-only input and exclude it from lint/build behavior.

## Styling and Frontend UX

- Keep the terminal-first workflow central.
- Use compact, scan-friendly UI for HUD and game panels.
- Ensure core controls are keyboard reachable and visible focus states remain intact.
- Check mobile-sensitive UI at 390px width for no horizontal page scrolling.
- Color-coded states must also expose text labels or numeric values.

## Error Handling

- Fail loudly in development for invalid assumptions.
- Fail gracefully in production UI with actionable connection or protocol messages.
- Parser errors should not crash the proxy or browser session.
- Unknown MSDP variables should be ignored safely or surfaced only in deliberate debug paths.
- Do not swallow socket errors without sending an appropriate connection status.

## Testing

- Add tests near the behavior under change once a test framework is introduced.
- Test behavior and protocol contracts, not implementation details.
- Parser tests should include split IAC, doubled IAC, malformed MSDP, arrays, tables, NAWS, and TTYPE.
- Reconnect work should validate repeated connect/disconnect cycles.
- UI mapping tests should distinguish unavailable data from zero or empty values.

## Configuration and Persistence

- Runtime MUD defaults come from shared app settings and `/api/settings`.
- Browser persistence must not store passwords or secrets.
- Import/export formats need version fields and tolerant parsing.
- Settings migrations should preserve user overrides where practical.
- Movement shortcuts must not pollute command history unless intentionally configured.
- Existing browser persistence uses chunked cookies for settings, aliases, and triggers. Treat this as current behavior, not a pattern to expand for sensitive or large data.
- Import normalizers should reject malformed entries with actionable messages and preserve current user data when importing partial alias or trigger files.

## Dependencies

- Prefer existing stack dependencies before adding new packages.
- Justify new protocol, terminal, or parser dependencies with maintenance and licensing notes.
- Keep lockfile changes intentional and tied to the implementing session.
- Evaluate xterm.js through a documented terminal-renderer decision before migration.

## Local Dev Tools

| Category       | Tool             | Config                                               |
| -------------- | ---------------- | ---------------------------------------------------- |
| Formatter      | Prettier         | `.prettierrc.json`, `npm run format`                 |
| Linter         | ESLint           | `eslint.config.js`, `npm run lint`                   |
| Type Safety    | TypeScript       | `tsconfig.json`, `npm run build`                     |
| Frontend Build | Vite             | `vite.config.ts`, `npm run build`                    |
| Server Runtime | tsx/Node         | `npm run dev:server`, `npm run start`                |
| Testing        | Node test runner | `node --import tsx --test tests/*.test.ts`, `tests/` |
| Database       | not configured   | No DB signals detected                               |

## CI/CD

| Bundle       | Status     | Workflow                            |
| ------------ | ---------- | ----------------------------------- |
| Code Quality | configured | `.github/workflows/quality.yml`     |
| Build & Test | configured | `.github/workflows/test.yml`        |
| Security     | configured | `.github/workflows/security.yml`    |
| Integration  | configured | `.github/workflows/integration.yml` |
| Operations   | configured | `.github/workflows/deploy.yml`      |

## Infrastructure

| Component | Status         | Details                                                                                                                                                        |
| --------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health    | configured     | Express `GET /health` returns 200 JSON with `{ "ok": true }`; local and production probes target `/health`.                                                    |
| Local Dev | configured     | `npm run build && npm start` serves the production build on port 5191.                                                                                         |
| Probe     | manual         | Operator-hosted PM2/load-balancer or uptime checks should probe `https://<origin>/health`; PM2 has no in-repo HTTP probe configuration.                        |
| Security  | partial        | The server applies per-IP HTTP rate limiting, per-socket command throttling, per-IP WebSocket caps, and origin checks; edge WAF rules remain operator-managed. |
| Backup    | not configured | No server-side database or backup target exists in this repository.                                                                                            |

## Git and Review

- Keep commits to one logical change.
- Explain behavior and risk in PR descriptions; reviewers can inspect the implementation.
- Reference source protocol facts when changing MSDP mappings or feature support.
- Treat license-sensitive reference work as original implementation with documented inspiration only.
