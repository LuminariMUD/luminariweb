# Developer Onboarding

This page covers repository setup. For the player's structured account and
character-creation experience, its paired MUD requirements, media ownership,
and deployment topology, see
[Structured Account and Character Onboarding](structured-onboarding.md).

## Prerequisites

- [ ] Node.js and npm installed.
- [ ] Git installed.
- [ ] Network access to at least one configured MUD host if testing live connections.

## Setup

```bash
git clone https://github.com/LuminariMUD/luminariweb.git
cd luminariweb
npm install
npm run dev
```

Open `http://localhost:5190`.

## Verify Setup

- [ ] `npm run dev` starts the Vite client and Node proxy.
- [ ] `curl http://localhost:5191/health` returns `{ "ok": true }`.
- [ ] The browser loads the app at `http://localhost:5190`.
- [ ] `npm test` passes.
- [ ] `node --import tsx --test tests/proxy-deployment-policy.test.ts` passes when changing public proxy deployment behavior.
- [ ] A selected preset or custom host can attempt a MUD connection and the terminal plus panels respond normally.
- [ ] A paired protocol-v1 MUD produces structured account and
      character-creation screens; an older or unrelated MUD stays on the
      classic terminal.
- [ ] Character, combat, group, affects, inventory, room, map, and quest tabs show explicit available, unavailable, or override-only states instead of blank placeholders.

## Required Secrets

No secrets are required by the web repository for local development. The
paired Luminari-Source server has its own database and runtime configuration;
follow that repository's setup and credential-handling instructions without
copying its secrets into this project.

## First Files to Read

- `README.md` for commands and project map.
- `docs/ARCHITECTURE.md` for runtime flow.
- `docs/structured-onboarding.md` for the cross-repository account and
  character-creation contract.
- `docs/deployment.md` and `docs/bridge-deployment-options.md` for the supported public topology.
- `docs/runbooks/bridge-fallback.md` before considering any standalone bridge fallback.
- `shared/app-settings.ts` for ports, presets, and display defaults.
- `shared/README_shared.md` for shared display helper entry points.
- `tests/README.md` for current coverage and manual smoke expectations.
- `docs/prev_prd/PRD.md` for historical product requirements and protocol decisions.

## Reference Boundaries

`EXAMPLES/` repositories are research inputs only. Do not copy source, service
files, Docker files, sample maps, command text, or configuration from bridge
projects into the product. Summarize behavior in original wording and keep the
integrated Luminari Web proxy as the default public `/ws` implementation unless
a future spec changes that boundary.
