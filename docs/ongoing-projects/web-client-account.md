# Web Account and Character Creation Experience

**Status:** Protocol v2 is live in production. The account flow, core character
creator, role-play identity suite, and managed-mTLS production transport are
implemented; retry reliability, manual accessibility/media review, and
long-duration/load evidence remain open.

**Last audited:** 2026-07-29

**Protocol:** `LUMINARI_ONBOARDING` versions 2 and 1, with capability-driven
classic-terminal fallback

## Purpose and Authority

This is the ongoing project record for the account lobby, guided character
creation, and role-play identity suite shared by Luminari Web and
Luminari-Source. It records the deployed result and remaining work, not the
original estimate or completed implementation checklist.

Adjacent detail lives in:

- [Structured onboarding protocol and local operation](../structured-onboarding.md)
- [Production activation and remaining deployment gates](../deploy-production.md)
- [Production transport architecture](../ARCHITECTURE.md#managed-mtls-origin-decision)
- [Production mTLS transport operation](../runbooks/mtls-transport.md)
- [Onboarding media production and approval checklist](../manifest.md)
- [Security and compliance findings](../SECURITY-COMPLIANCE.md)
- [General deployment and rollback operation](../deployment.md)
- [Protocol-v2 architecture decision](../adr/0004-onboarding-protocol-v2.md)

The runtime contract in `shared/onboarding.ts` and the paired implementation in
`Luminari-Source/src/systems/web_client/onboarding.{c,h}` are authoritative
when this record and code disagree.

## Current Delivery Status

| Phase                                  | State                         | Remaining qualification                                                                         |
| -------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| 0. Contract and safety                 | Substantially complete        | Fix core-flow same-state retry signalling.                                                      |
| 1. Account flow and lobby              | Deployed with reliability gap | Invalid account names and some password failures can leave a guided form pending.               |
| 2. Core character creator              | Deployed                      | Rules and validation remain source-owned; some locked choices are hidden rather than explained. |
| 3. Role-play identity suite            | Deployed and verified         | All 29 v2 screens, 14 hub items, private editors, catalogs, and forced gate are live.           |
| 4. Media integration                   | Engineering complete          | Human creative, canon, provenance, similarity, licensing, and final approval are open.          |
| 5. Production hardening and acceptance | In progress                   | Manual accessibility/media review and long-session, load, CPU, and Range evidence remain.       |

The browser provides guided forms and galleries without moving authentication
or game rules out of the MUD. Luminari-Source publishes a bounded view of its
`nanny()` state; the gateway validates it and its actions; React renders
supported states; and the classic terminal remains available for legacy,
unsupported, or malformed peers.

## Architecture and Trust Boundaries

```text
Browser
  | HTTPS/WSS
  v
Cloudflare Worker + Static Assets
  | fixed managed-mTLS WSS
  v
Exact-name Apache origin
  | exact /gateway/ws proxy
  v
Loopback Node protocol gateway
  | fixed loopback Telnet
  v
Luminari-Source nanny() state machine
  |
  v
Account, character, player-file, and database persistence
```

- Luminari-Source owns authentication, legal choices, unlocks, restrictions,
  generated examples, one-time rules, mutation, and persistence.
- The Worker enforces same-origin admission and relays frames. The integrated
  Node gateway validates protocol state and browser actions. Neither
  implements game rules.
- React owns presentation, ephemeral drafts, media/audio preferences,
  accessibility behavior, and terminal switching.
- Accepted ordinary actions resolve to the exact line value consumed and
  revalidated by `nanny()`.
- The browser and origin network legs are encrypted. The Worker authenticates
  to the exact origin with managed mTLS; Apache then proxies to a loopback-only
  Node gateway, which dials the MUD on host loopback. This resolved
  `ONBOARD-SEC-001` for web sessions. Public direct Telnet remains a separate
  plaintext legacy service and is never a Worker fallback.

The production Worker connects only through the `MUD_ORIGIN_MTLS` binding to
the fixed origin URL, and the production gateway's injected socket factory
always dials `127.0.0.1:4100`. The browser-visible
`luminarimud.com:4100` destination remains a logical compatibility value, not a
physical routing choice. The integrated Node gateway's ordinary mode supports
local and operator-controlled deployments with hostname/address allowlists and
DNS safety checks. Both modes use the same `MudSession`, Telnet parser,
contract, and message model.

### Implementation Map

| Boundary        | Primary implementation                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared contract | `shared/onboarding.ts`, `shared/onboarding-transfer.ts`, `shared/client-message.ts`, and `shared/mud.ts`                                                      |
| Gateway         | `worker/index.ts`, `worker/websocket-relay.ts`, `server/gateway-runtime.ts`, `server/index.ts`, `server/mud-session.ts`, and `server/telnet-parser.ts`        |
| Browser         | Reducer, screens, media resolution, and audio under `src/features/onboarding/`                                                                                |
| Media pipeline  | `scripts/process-onboarding-media.mjs`, metadata, and `src/features/onboarding/generated-media-manifest.json`                                                 |
| Local fixtures  | `scripts/synthetic-onboarding-mud.mjs` and `scripts/onboarding-preview-server.mjs`                                                                            |
| Paired source   | `src/systems/web_client/onboarding.{c,h}`, `src/protocol.c`, `src/comm.c`, `src/interpreter.c`, `src/roleplay.c`, `src/char_descs.c`, and `src/backgrounds.c` |
| Verification    | Web onboarding unit/session/media tests, Playwright, source CuTest, protocol-parser tests, and the bounded parser fuzzer                                      |

## Protocol, Actions, and Fallback

The gateway always sends the v1 capability
`LUMINARI_ONBOARDING_VERSION=1`, followed unconditionally by
`LUMINARI_ONBOARDING_VERSIONS=2,1`. The current source always includes v2 and
selects the highest shared version.

| Web and source combination        | Result                                                      |
| --------------------------------- | ----------------------------------------------------------- |
| Current web and current source    | Full structured account, creation, and role-play experience |
| Current web with an old v1 source | Core v1 flow; role-play states use the classic terminal     |
| Old web or ordinary Telnet client | Existing text menus                                         |
| Missing or malformed capability   | Recoverable classic-terminal path without disconnect        |

Protocol v2 is a permanent product capability, not an operational toggle.
Rollback means restoring the last known-good complete web/source releases; it
does not mean disabling RP.

The contract contains 22 baseline screen IDs and 29 additional v2 role-play
screen IDs. Every state carries its selected version, flow ID, and revision.
The gateway accepts an action only when its version, flow, exact revision,
screen, field, action, and offered choice match the current state.

| Path or failure                             | Handling                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Small menu, confirm, and text action        | Validated by the gateway, translated to the source-offered legacy line, then revalidated by `nanny()` |
| Private multiline editor action             | Uses reserved, bounded `LUMINARI_ONBOARDING_ACTION` and `LUMINARI_ONBOARDING_CONTENT` envelopes       |
| Stale, forged, or disallowed action         | Rejected without a MUD write                                                                          |
| Malformed, oversized, or incompatible state | Emits an explicit fallback and keeps terminal input/output usable                                     |
| Unsupported source state                    | Hands control to the terminal                                                                         |
| Disconnect                                  | Clears structured state, sensitivity, drafts, and transfers                                           |

### Bounds and Atomic Editor Transfer

Normal state documents carry metadata, summaries, pages, and details, never
full private profile fields. Large fields move atomically in both directions:

```text
Browser draft
  -> begin / base64 chunks / commit
Gateway
  -> validate flow, revision, field, UTF-8, size, order, rate, and SHA-256
Luminari-Source
  -> revalidate, normalize, mutate, checked save, and publish a new result
```

| Limit or invariant         | Current value or behavior                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| Source state payload       | 15,000 bytes                                                                                   |
| Gateway state boundary     | 16 KiB                                                                                         |
| Serialized MSDP frame      | Strictly below the source's 12 KiB protocol buffer                                             |
| Browser message boundary   | 65,536 UTF-8 bytes                                                                             |
| Editor content             | Field limit, capped globally at 49,152 bytes                                                   |
| Long-description field     | 4,096 bytes                                                                                    |
| Raw chunk / maximum chunks | 6,144 bytes / 8                                                                                |
| Transfer lifetime          | 30 seconds                                                                                     |
| Concurrent transfer state  | One inbound and one outbound per session                                                       |
| Editor commit budget       | 12 commits and 512 KiB per 60 seconds                                                          |
| Integrity                  | Ordered indexes, exact sizes, canonical base64, and SHA-256                                    |
| Mutation                   | None until the complete transfer passes every check                                            |
| Cleanup                    | Success, rejection, timeout, state/character/account change, fallback, disconnect, and unmount |

Ordinary structured actions retain a separate 30-actions-per-10-seconds limit;
terminal commands retain 20 commands per 10 seconds. Errors and metrics use
safe codes and sizes only; they never echo private content.

## Product Coverage

### Baseline Account and Character Creation

| Surface                    | Structured behavior                                                                  | Known limitation                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Login and account creation | Account name, masked password, confirmation, and safe sensitive-input routing        | Several same-state rejections do not refresh the form.                                  |
| Account lobby and linking  | Character cards plus create, link, select, and quit                                  | No structured capacity/full-account signal; some link failures return without a reason. |
| Existing-character menu    | Enter world, role-play profile in v2, and return to account                          | Password change, deletion, and other advanced operations remain terminal-only.          |
| New-character core         | Name, sex, race/detail, class/detail, build, alignment, preferences, and RP decision | Locked or illegal race/class options are omitted rather than displayed with reasons.    |
| MOTD and play handoff      | Structured continuation into the terminal/game UI                                    | Initial negotiation can briefly publish `handoff` before `account-name`.                |

The paired source derives race, class, build, and alignment choices from live
tables and account unlocks. The browser never recreates legality rules.

Live account cards contain character ID, name, selection wire value, level,
race, race media key, and a text class summary. The contract can also represent
class media keys, status, and incomplete state, but the source does not
currently emit them.

### Protocol-v2 Role-play Identity Suite

The hub covers all 14 current profile items: short description, long
description, background story, background archetype, goals, personality,
ideals, bonds, flaws, age, homeland region, faction, hometown, and deity.

| Flow family            | Implemented behavior                                                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry and hub          | New-role-player and selected-character entry; source-authored item status, safe summaries, required/locked reasons, open, return, and quit                       |
| Short description      | Optional and forced flows; race-filtered feature/adjective catalogs, preview, restart, optional second descriptor, checked completion, and one-time play handoff |
| Private writing        | Seven multiline editors for long description, background story, goals, personality, ideals, bonds, and flaws at source byte limits                               |
| Ideas                  | Source-generated goal and background-themed suggestions for goals, personality, ideals, bonds, and flaws; insertion affects only the local draft                 |
| Authoritative catalogs | Background, age, region, runtime faction, hometown, and deity lists, details, paging, confirmation, stable IDs/media keys, and one-time restrictions             |
| Failure and recovery   | Same-state v2 errors publish a new revision; save failure rolls back and never reports durable success; terminal switching remains available                     |

Source-owned pending selections prevent preview screens from mutating permanent
character data. One-time rules are rechecked at commit, including age
eligibility and already-configured background, region, faction, hometown, and
deity choices. Short descriptions remain source-generated rather than
free-form.

## Persistence and Private Data

Protocol-v2 role-play commits use `save_char_checked()`. Each commit snapshots
the affected character and player-index fields, revalidates and applies the
change, attempts the save, restores the snapshot on failure, and reports
durable success only after the checked save succeeds. Forced short-description
completion is persisted before entering the world.

Protocol-v1 core screens still infer `draft`, `pending`, or `saved` from the
connection state. They cannot distinguish every player-file, database,
account-link, or save failure, so their `saved` presentation is not a write
acknowledgement.

Sensitive inputs and private editor content:

- bypass command history, aliases, triggers, completion, and browser
  persistence;
- are cleared from inputs and component memory on submission or lifecycle
  exit;
- exist transiently in gateway memory only as needed for transport.

Passwords, profile text, character names, and selections do not enter
analytics, service-worker caches, committed fixtures, test recordings,
screenshots, or application logs.

Structured password inputs are masked. Classic terminal input combines
Telnet-ECHO and structured sensitivity signals and fails hidden when they
disagree. The service worker caches only the static shell and versioned media.
Cloudflare necessarily handles session plaintext in Worker memory, while mTLS
protects the public Worker-to-origin leg and the post-TLS gateway-to-MUD leg is
host-loopback only. Public direct Telnet remains a distinct plaintext legacy
path outside the web-session boundary.

## Frontend and Media

The React experience provides guided forms, galleries, detail screens, lobby
cards, a role-play hub, private editors, visible byte counts, irreversible
confirmation, live error/success regions, responsive layouts, and explicit
terminal controls. Dirty editor drafts require discard confirmation and remain
only in component memory.

Reduced motion removes parallax, motes, and dependent transitions without
removing information. A browser `saveData` preference selects text-only
presentation by suppressing catalog images, scene art/layers, and audio.
Audio otherwise defaults on, subject to browser autoplay policy, with stored
music/ambience/effect volumes of `0.40`, `0.35`, and `0.60`; no cue carries
information unavailable on screen.

### Role-play Asset Decision

No new image, icon, font, music, ambience, sound effect, video, voice, or
avatar asset is required for the identity suite. Known entries have dedicated
art and runtime/extensible entries have category fallbacks; missing media
degrades to text without blocking a choice.

| Surface                    | Current inventory                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Hub and writing            | Dedicated hub, short/long description, background story, goals, personality, ideals, bonds, and flaws art               |
| Age and background         | Five age entries; 16 backgrounds plus a background fallback                                                             |
| Locations and affiliations | World map, 13 regions plus fallback; two known factions plus fallback; Ashenport plus hometown fallback                 |
| Deity                      | `none`, 21 named deities, and a deity fallback                                                                          |
| Scene and recovery         | Shared `scene/roleplay` at desktop/tablet/mobile; eight completion/recovery assets                                      |
| Audio                      | Role-play music and ambience plus editor, example, preview, confirmation, persistence, navigation, and fallback effects |

Mechanical evidence at the audit snapshot:

| Check                              | Result                                                        |
| ---------------------------------- | ------------------------------------------------------------- |
| Generated manifest                 | 271 assets                                                    |
| Published references traversed     | 1,710, with 0 missing files                                   |
| Focused manifest checks            | 19/19 passing                                                 |
| V2 screen scene mapping            | 29/29 use `scene/roleplay`; play handoff uses `scene/handoff` |
| Hub semantic defaults              | All 14 resolve; unset age intentionally uses neutral hub art  |
| Fixed and runtime catalog behavior | Dedicated fixed keys and category-complete fallbacks pass     |

Before final media acceptance, capture the target runtime faction and hometown
catalogs, verify dedicated versus fallback keys, exercise deliberate
missing-image/unavailable-audio behavior, and complete human creative, canon,
provenance, similarity, and licensing review. Dedicated art for additional
stable runtime entries is optional and must not remove fallback behavior.

## Production and Verification Evidence

| Repository or deployment | Audited production state                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `luminariweb`            | `main@4ff8f9c`; origin gateway release `4ff8f9cd`; Worker relay version `773288a8-cb00-4e05-bb24-c0da37c5c1ee`         |
| `Luminari-Source`        | `master@081618fa`; running/installed binary SHA-256 `3112236ccbfd4dab44fa9be7269071f1e2258aa849980d74a3776e9622225a35` |

Protocol v2 was activated on 2026-07-29. Repeated production walks at
1440 x 1000 and 390 x 844 negotiated v2, loaded all 14 hub cards and images,
opened a real private editor, and returned through character/account menus to
Quit without console errors, page errors, warnings, or horizontal overflow.

The first v2 copyover exposed an allocator failure. Supervision restored the
exact v1 binary; three memory-safety defects were fixed and regression-tested
before a clean rebuild and successful second copyover. Exact rollback artifacts
were retained, and the final process remained healthy beyond the earlier
failure window.

Later on 2026-07-29, the web route moved fully to managed mTLS, the prior
plaintext Worker sessions were drained, the predecessor client identity was
rotated out and proven revoked, and desktop/mobile onboarding plus
private-editor traffic passed through the secure route. Exact deployment
identifiers, negative tests, packet-capture evidence, and the independent
closure review remain in
[Production Deployment](../deploy-production.md#managed-mtls-transport-activation-evidence)
and [Security and Compliance](../SECURITY-COMPLIANCE.md#onboard-sec-001-closure-evidence).

Still later that day, a normal source rebuild omitted the temporary v2
compiler definition and silently downgraded production to v1. The web and
source rollout switches were removed in `main@4ff8f9c` and
`master@081618fa`. The live gateway now advertises `2,1` unconditionally, the
source compiles v2 by default and rejects the retired macro, and a fresh
production walk again passed all 14 RP cards and the Background story
cancel/return path.

| Check                                             | Result                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| Luminari Web Node suite                           | PASS, 338/338                                                    |
| Lint, repository formatting, and production build | PASS; build retains a JavaScript chunk-size warning              |
| Playwright real-listener/synthetic-MUD gate       | PASS, 3/3 at desktop, 390 px, and 360 px; 360 px uses `saveData` |
| Luminari-Source permanent-v2 default suite        | PASS, 210/210                                                    |
| Retired source compiler definition                | PASS; rejected whether defined as `0` or `1`                     |
| Source protocol parser and bounded sanitizer fuzz | PASS, 13/13 parser tests and ASan/UBSan libFuzzer run            |
| Source install hook                               | PASS; removed the root `circle` artifact                         |
| Live production permanent-v2 walkthrough          | PASS; 14/14 cards and loaded images, editor cancel/return        |
| Post-copyover runtime audit                       | PASS; PID/sockets preserved and running/installed hashes match   |

Automated coverage spans contract parsing, reducer behavior, version skew,
mandatory v2 negotiation, bidirectional transfers, exact field limits,
stale/forged input, save rollback, media fallback, privacy cleanup, a real Node
listener and synthetic TCP MUD, and the compiled source adapter. It does not
replace the open manual or long-duration gates below.

## Open Work

Work in this order:

1. **Fix same-state core-flow retries.** Invalid account name, wrong existing
   account password, and illegal new password can leave React pending because
   the source remains in the same state without publishing a new revision.
   Emit a safe structured result or mark every such path dirty, and add
   regressions for all three.
2. **Complete manual acceptance.** Record keyboard-only, screen-reader,
   contrast, reduced-motion, deliberate image-failure, unavailable-audio, and
   representative-device review. Capture target runtime faction/hometown media
   resolution without recording private profile content.
3. **Collect operational evidence.** Run long sessions, concurrent load, MUD
   CPU measurement, production audio HTTP Range verification, and a longer
   aggregate-only observation window.
4. **Finish media and performance sign-off.** Complete creative/canon/license
   approval and measure the warned JavaScript chunk on representative mobile
   hardware and a slow network.
5. **Improve v1 result fidelity.** Replace inferred core-flow persistence with
   explicit acknowledgements where practical. A downgraded v1 enter-world path
   still hands the forced short-description gate to the terminal.
6. **Decide later structured scope.** Advanced character-menu operations,
   account capacity, richer live character summaries, hidden-choice reasons,
   and the brief initial negotiation handoff remain deliberately outside the
   completed role-play scope.

Phase 3 application/source functionality is complete. The open work is
reliability, acceptance, operational evidence, and optional product expansion.

## Rollback and Repeatable Checks

The structured role-play suite has no disable path. If a release regresses it,
restore the last known-good complete gateway and source releases and verify
the full RP path. No profile schema or player-file migration is involved, so
data written to existing source fields remains valid across a release
rollback.

Transport rollback is deliberately separate from protocol-version rollback.
Follow the [mTLS transport runbook](../runbooks/mtls-transport.md) so
certificate or origin failures remain fail closed and any emergency plaintext
rollback is an explicit, audited security regression.

From `luminariweb`:

```bash
npm test
npm run test:e2e
npm run lint
npm run build
npm run format:check
npx prettier --check docs/ongoing-projects/web-client-account.md
```

Run `npm run test:e2e:install` once if the local Playwright browser is absent.

From a confirmed non-production `Luminari-Source` checkout:

```bash
make clean
make test
make install
```

Follow the source repository instructions and run `make install` after its
root tests. The source rejects the retired v2 compiler switch, preventing a
build command from compiling RP out. Use the production runbook for any
external activation or rollback; local test success alone does not authorize
deployment.
