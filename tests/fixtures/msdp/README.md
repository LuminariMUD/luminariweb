# MSDP Fixture Corpus

This directory contains versioned MSDP parser fixtures for Luminari Web. The corpus lets future parser and state-mapping tests exercise confirmed Luminari-Source data shapes without opening a live MUD connection.

The fixtures are intentionally small, synthetic unless explicitly labeled otherwise, and focused on parser input/output contracts. They do not define UI rendering behavior and do not change application runtime behavior.

## Directory Contract

| Path                        | Purpose                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `manifest.json`             | Corpus index, coverage tags, origin metadata, and parser expectation summaries.         |
| `core-scalars.json`         | Server metadata, character identity, ability scores, and scalar normalization examples. |
| `combat-and-resources.json` | Resource, experience, combat, tank, position, money, and practice examples.             |
| `room-and-exits.json`       | Room identity, partial values, exits, world time, empty values, and raw room examples.  |
| `collections.json`          | Actions, inventory, affects, empty arrays, and simple table examples.                   |
| `group-data.json`           | Representative group member table, empty, unknown-field, and object-like examples.      |
| `nested-tables.json`        | Mixed nested table and array payload examples.                                          |
| `malformed-payloads.json`   | Malformed payload examples with safe expected parser output.                            |

Future tests should load `manifest.json` first and then resolve each fixture file listed in the manifest. Tests should not hard-code a partial set of fixture filenames.

## Control Tokens

Fixture payloads use human-readable token streams instead of raw byte arrays. Test helpers can convert these tokens to raw MSDP bytes by replacing token strings with the byte values below and UTF-8 encoding all other strings.

| Token         | Byte | Parser Constant    | Meaning                                 |
| ------------- | ---- | ------------------ | --------------------------------------- |
| `VAR`         | `1`  | `MSDP_VAR`         | Starts a variable name or table key.    |
| `VAL`         | `2`  | `MSDP_VAL`         | Starts a variable value or table value. |
| `TABLE_OPEN`  | `3`  | `MSDP_TABLE_OPEN`  | Starts a table payload.                 |
| `TABLE_CLOSE` | `4`  | `MSDP_TABLE_CLOSE` | Ends a table payload.                   |
| `ARRAY_OPEN`  | `5`  | `MSDP_ARRAY_OPEN`  | Starts an array payload.                |
| `ARRAY_CLOSE` | `6`  | `MSDP_ARRAY_CLOSE` | Ends an array payload.                  |

Example scalar payload:

```json
["VAR", "LEVEL", "VAL", "17"]
```

Expected parser pair:

```json
[["LEVEL", 17]]
```

## Fixture JSON Shape

Each fixture file contains a file-level version and a `fixtures` array:

```json
{
  "schemaVersion": 1,
  "fixtureFile": "core-scalars",
  "description": "Short file purpose.",
  "fixtures": [
    {
      "id": "core.character.identity",
      "version": 1,
      "origin": {
        "type": "synthetic",
        "capturedAt": null,
        "source": "Constructed from PRD source facts.",
        "sanitized": true
      },
      "description": "Short fixture purpose.",
      "coverage": ["character", "scalar"],
      "sourceFacts": ["PRD Source Protocol Facts confirms CHARACTER_NAME, LEVEL, RACE, and CLASS."],
      "payloadTokens": ["VAR", "LEVEL", "VAL", "17"],
      "expectedPairs": [["LEVEL", 17]],
      "notes": ["Numeric integer strings normalize to numbers in the current parser."]
    }
  ]
}
```

### Required Fields

| Field               | Type           | Rule                                                                         |
| ------------------- | -------------- | ---------------------------------------------------------------------------- |
| `id`                | string         | Globally unique across the corpus. Use dotted names grouped by file purpose. |
| `version`           | number         | Increment when a fixture meaningfully changes.                               |
| `origin.type`       | string         | `synthetic` or `real-capture`.                                               |
| `origin.capturedAt` | string or null | ISO-like timestamp for real captures; `null` for synthetic fixtures.         |
| `origin.source`     | string         | Human-readable source or construction note.                                  |
| `origin.sanitized`  | boolean        | Must be `true` before a real capture can be committed.                       |
| `description`       | string         | Short explanation of the parser behavior under coverage.                     |
| `coverage`          | string array   | Tags used by manifest and future test selection.                             |
| `sourceFacts`       | string array   | PRD or source-audit facts that justify variable names and expected output.   |
| `payloadTokens`     | string array   | Control-token names plus scalar strings in payload order.                    |
| `expectedPairs`     | array          | Parser output as `[variable, value]` tuples.                                 |
| `notes`             | string array   | Review and future-test guidance.                                             |

### Expected Pair Values

Expected values use the current parser contract:

- Integer strings become JSON numbers, including negative integer strings.
- Non-integer strings remain strings.
- Tables become JSON objects.
- Arrays become JSON arrays.
- Empty variables are ignored and therefore do not appear in `expectedPairs`.
- Malformed payload fixtures must describe the safety expectation and still provide `expectedPairs`.

## Source-Fact Coverage Matrix

The PRD source protocol facts confirm these variable groups from Luminari-Source. Fixture coverage should remain traceable to these groups and should not imply unsupported data is emitted.

| Source Group           | Confirmed Variables Covered                                                                                                           | Fixture Files                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Server/client metadata | `SERVER_ID`, `SERVER_TIME`, `SNIPPET_VERSION`                                                                                         | `core-scalars.json`                                         |
| Character              | `CHARACTER_NAME`, `TITLE`, `LEVEL`, `RACE`, `CLASS`, `POSITION`, `ALIGNMENT`, `MONEY`, `PRACTICE`, `FORTITUDE`, `REFLEX`, `WILLPOWER` | `core-scalars.json`, `combat-and-resources.json`            |
| Resources              | `HEALTH`, `HEALTH_MAX`, `PSP`, `PSP_MAX`, `MOVEMENT`, `MOVEMENT_MAX`, `EXPERIENCE`, `EXPERIENCE_MAX`, `EXPERIENCE_TNL`                | `combat-and-resources.json`                                 |
| Combat                 | `ATTACK_BONUS`, `AC`, `OPPONENT_NAME`, `OPPONENT_HEALTH`, `OPPONENT_HEALTH_MAX`, `TANK_NAME`, `TANK_HEALTH`, `TANK_HEALTH_MAX`        | `combat-and-resources.json`                                 |
| Ability scores         | `STR`, `INT`, `WIS`, `DEX`, `CON`, `CHA`                                                                                              | `core-scalars.json`                                         |
| Collections            | `ACTIONS`, `INVENTORY`, `AFFECTS`, `GROUP`                                                                                            | `collections.json`, `group-data.json`, `nested-tables.json` |
| Room/world             | `ROOM`, `AREA_NAME`, `ROOM_EXITS`, `ROOM_NAME`, `ROOM_VNUM`, `WORLD_TIME`, `MINIMAP`                                                  | `room-and-exits.json`, `nested-tables.json`                 |
| Parser safety          | Skipped leading bytes, truncated values, empty variable names, incomplete tables, incomplete arrays                                   | `malformed-payloads.json`                                   |

## Room Fixture Notes

`room-and-exits.json` includes representative display and parser contracts for confirmed room/world variables:

- Room identity scalars with room name, area name, zero room vnum, world time, blank strings, and partial values.
- `ROOM_EXITS` as a keyed table, scalar string, array of direction labels, object-like rows, explicit empty array, and malformed-looking raw fallback string.
- `ROOM` as a structured table, explicit empty table, scalar raw fallback, and partial table with unknown fields.
- `MINIMAP` as plain source-backed display text.
- Bounded raw fallback cases that preserve useful uncertain data without treating terminal room prose as live minimap input.

These shapes are synthetic. They verify parser, state-mapping, and display behavior for source-confirmed room variables, but they do not prove final live server room or exit field names.

Phase 03 mapper tests also use these synthetic room and exit shapes to verify the bounded current-room mapper display. That mapper coverage is limited to current room identity, deterministic directional exit branches, vertical and custom exit summaries, raw malformed fallback text, and source-backed `MINIMAP` fallback separation. It does not define persistent world-map storage, destination discovery, coordinate schemas, or a richer minimap schema.

## Group Fixture Notes

`group-data.json` confirms parser and display contracts for representative `GROUP` payloads:

- Full member arrays with names, leader flags, health, movement, movement maximums, and status text.
- Partial member arrays with missing names, missing maximums, blank status, and zero resource values.
- Explicit empty arrays that remain present data rather than missing data.
- Unknown member fields that display code may summarize conservatively.
- Object-like top-level tables that preserve member records and raw entries without claiming final source member identifiers.

These shapes are synthetic. They verify client parser, mapping, and display behavior for a source-confirmed `GROUP` variable, but they do not prove final server member field names.

## Affects And Inventory Fixture Notes

`collections.json` includes representative display contracts for source-confirmed `AFFECTS` and `INVENTORY` payloads:

- Affects arrays with names, zero and nonzero durations, modifier fields, raw string entries, partial records, unknown fields, and object-like top-level tables.
- Inventory arrays with item records, counts, locations, long names, grouped tables, counted entries, worn-item arrays, scalar raw fallback text, and unknown fields.
- Explicit empty arrays and tables that remain present data rather than missing variables.

These shapes are synthetic. They verify parser, mapping, and display behavior for source-confirmed collection variables, but they do not prove final live server affect or inventory field names.

### Override-Only Exclusions

The default client preserves some user-configurable override slots without treating them as source-backed emitted values. This corpus excludes source-backed fixtures for:

- `DAMAGE_BONUS`
- `QUEST_INFO`

Those names may appear in future fixtures only when the fixture is explicitly testing override behavior, unsupported-data behavior, or a later source-level protocol change.

## Review Checklist

Use this checklist when adding or changing fixtures:

- [ ] Every fixture id is globally unique and listed in `manifest.json`.
- [ ] Every fixture has `version`, `origin`, `coverage`, `sourceFacts`, `payloadTokens`, `expectedPairs`, and `notes`.
- [ ] Synthetic fixtures are labeled `origin.type: "synthetic"`.
- [ ] Real captures are labeled `origin.type: "real-capture"`, scrubbed, and marked `origin.sanitized: true`.
- [ ] No passwords, private player commands, host secrets, tokens, or private live session data are present.
- [ ] Malformed fixtures state the malformed condition and expected safe output.
- [ ] `payloadTokens` use documented control-token names and plain scalar strings only.
- [ ] Expected numeric values match current integer normalization rules.
- [ ] Fixture files parse as JSON.
- [ ] Files remain ASCII-only with Unix LF line endings.
- [ ] Future tests can derive bytes from tokens without needing a live MUD connection.

## Future Test Consumption

Future parser tests should use this corpus in two steps:

1. Load `manifest.json`.
2. Load each listed fixture file and encode `payloadTokens` into a raw MSDP payload buffer.

A minimal encoder can treat the six documented control-token names as byte values and all other strings as UTF-8 scalar bytes:

```ts
const controlTokens = {
  VAR: 1,
  VAL: 2,
  TABLE_OPEN: 3,
  TABLE_CLOSE: 4,
  ARRAY_OPEN: 5,
  ARRAY_CLOSE: 6,
} as const;
```

For each `payloadTokens` entry:

- If the string is a key in `controlTokens`, append that byte.
- Otherwise, append `Buffer.from(value, "utf8")`.
- Empty strings append no bytes and are valid when testing empty variable names or empty scalar values.

Parser tests should compare decoded output directly with `expectedPairs`. State-mapping tests can then feed each expected pair into the mapping layer and assert the resulting `MudState` partials. UI tests should not depend on these fixtures directly until parser and state mapping contracts are stable.

Malformed fixtures should remain part of normal parser regression coverage. They are expected to produce safe partial output or empty values as documented, not process crashes, unbounded loops, or uncaught exceptions.
