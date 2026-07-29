# Browser Client

React browser client for connection controls, terminal display, HUD state, side panels, aliases, triggers, settings, and configuration import/export.

## Run Commands

| Command              | Purpose                              |
| -------------------- | ------------------------------------ |
| `npm run dev:client` | Run the Vite frontend server         |
| `npm run dev`        | Run frontend and proxy together      |
| `npm run build`      | Type-check and build frontend output |

## Key Files

- `App.tsx` contains the main client UI and browser-side behavior.
- `App.css` contains app styling.
- `main.tsx` mounts React.
- `index.css` contains global styling.

Shared message and state types come from `shared/mud.ts`.
