# Shared Types and Settings

Shared TypeScript module used by both the React client and Node proxy server.

## Key Files

- `app-settings.ts` defines ports, MUD presets, and personalization text.
- `mud.ts` defines browser/server message types, MUD state shape, default MSDP variable mappings, and mapping normalization.
- `msdp-state.ts` defines shared configured-variable filtering and pure MSDP-to-state mapping helpers.
- `msdp-map-display.ts` builds the room/exits map fallback model and source-backed `MINIMAP` state model.
- `msdp-quest-display.ts` builds the default-unavailable and override-only `QUEST_INFO` state model without parsing free-form quest prose.

## Run Commands

| Command         | Purpose                                |
| --------------- | -------------------------------------- |
| `npm run lint`  | Check shared TypeScript through ESLint |
| `npm run build` | Type-check and compile shared code     |

Keep shared contracts backward-compatible with the browser and server in the same change.
