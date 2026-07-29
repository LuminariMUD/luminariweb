# 0004. Structured Onboarding Protocol v2

**Status:** Accepted
**Date:** 2026-07-28
**Amended:** 2026-07-29 - rollout switches removed; v2 is permanently available

## Context

Protocol v1 (`shared/onboarding.ts`, `Luminari-Source/src/systems/web_client/onboarding.c`)
carries 22 structured screens and stops at the role-play decision. Everything
past that point emits `handoff` and drops the player onto the classic terminal.

Phase 3 of [web-client-account.md](../ongoing-projects/web-client-account.md)
requires the role-play identity suite to stay structured. That cannot be done by
adding screen names to v1, because four v1 properties block it:

1. **Transport size.** Six of the seven role-play text fields are
   `MAX_STRING_LENGTH` (49,152 bytes). One v1 onboarding state document is capped
   at 15,000 bytes on the source side and 16 KiB at the gateway. Editor content
   does not fit in a state document.
2. **Action fidelity.** Every v1 browser action resolves to a single legacy input
   line (`resolveOnboardingAction()`). That is safe for menu digits but cannot
   faithfully or safely carry multiline profile text — it would permit
   editor-command injection and bypass byte accounting.
3. **Persistence truth.** `save_char()` returns `void`. v1 has no way to
   distinguish "accepted in memory" from "durably written", so the browser cannot
   honestly report success.
4. **Version skew.** v1 has a single capability integer. There is no way to add
   capability without either breaking old sources or forcing a flag day.

## Options Considered

1. **Extend v1 in place.** Cheapest, but leaves editor content either truncated
   or smuggled through the legacy line path. Rejected: it cannot preserve the
   existing field limits and it widens the injection surface.
2. **A separate HTTP/REST profile service.** Would solve size trivially, but
   moves character authority out of Luminari-Source, requires a second identity
   and session system, and contradicts the plan's non-negotiable invariants.
   Rejected.
3. **A versioned protocol v2 over the existing MSDP channel, with a bounded
   chunked side-channel for editor content.** Chosen.

## Decision

Introduce onboarding protocol **v2**. v1 remains fully supported for the entire
rollout and is the rollback target.

### 1. Version negotiation

The client advertises both variables, oldest-compatible first:

```text
LUMINARI_ONBOARDING_VERSION=1      # unchanged; an old source still enables v1
LUMINARI_ONBOARDING_VERSIONS=2,1   # new; ignored by an old source
```

The source selects the highest mutually supported version and echoes it in
`state.version` on every state document. Current gateways always advertise
`2,1`, and current source builds always include v2.

| Web client           | MUD source    | Result                                       |
| -------------------- | ------------- | -------------------------------------------- |
| Old v1 web           | New source    | v1 core flow; role-play returns to terminal  |
| New web              | Old v1 source | v1 core flow; role-play returns to terminal  |
| New web              | New source    | Structured role-play suite                   |
| Any protocol failure | Any source    | Recoverable terminal fallback, no disconnect |

Compatibility negotiation remains, but it is not an operator kill switch.

### 2. State contract additions

v2 adds to the v1 state document:

- mode `roleplay-profile`;
- the role-play screen IDs enumerated in the plan's state matrix;
- input kind `multiline`;
- actions `continue`, `open`, `save-text`, `cancel-editor`, `generate-example`,
  `next-page`, `previous-page`;
- `profile` — a bounded hub summary of items, each with `id`, `label`,
  `status`, `mutable`, `required`, optional safe `summary`, optional
  server-authored `reason`, and optional `mediaKey`;
- `page` — optional source-owned catalog pagination metadata;
- `detail` — bounded selected-choice detail;
- `examples` — bounded server-generated suggestions;
- `editor` — metadata only: `fieldId`, `maxBytes`, `contentRevision`,
  `transferId`, `totalBytes`, `chunkCount`, `digest`;
- `persistenceResult` — distinguishes `accepted` (in memory), `saved`
  (checked durable write), and `failed`.

Hub item status is one of `unset`, `configured`, `required`, `locked`,
`unavailable`, `error`. All six are server-authored. The browser never derives
status, availability, or mechanical effect.

The full state document must remain under the existing 15,000-byte source cap.
The hub therefore carries completion metadata, never full private profile text.

### 3. Action routing

Two paths, deliberately kept separate:

1. **Legacy-line actions** — `select`, `submit`, `confirm`, `reselect`,
   `detail`, `cancel`, `quit`, `create-character`, `link-character`, and the new
   `continue`, `open`, `next-page`, `previous-page`, `generate-example`. These
   resolve to the exact server-offered wire value, exactly as in v1. Password
   routing is unchanged.
2. **Structured v2 actions** — editor transfer only (`save-text`,
   `cancel-editor`). These travel in a reserved MSDP action variable carrying a
   strict JSON envelope. The source revalidates version, flow, revision, screen,
   field, action, bounds, and transfer integrity before touching a helper.

Profile text is never encoded as terminal commands.

### 4. Bounded editor transfer

Both directions use an atomic begin/chunk/commit protocol.

```text
Browser textarea
  -> bounded WebSocket begin/chunk/commit messages
Gateway
  -> assemble; validate state, field, UTF-8, bytes, rate, digest
  -> emit bounded MSDP begin/chunk/commit actions
Luminari-Source
  -> assemble in descriptor-local memory
  -> validate exact transfer and source field rules
  -> mutate through a shared editor helper
  -> save_char_checked()
  -> emit a newer state with success or a safe error
```

Loading existing content reverses the path. No exact-limit value is ever placed
in one browser JSON message or one MSDP variable in either direction.

Frozen bounds:

| Bound                     | Value                                                    |
| ------------------------- | -------------------------------------------------------- |
| Raw chunk payload         | 6,144 bytes (8,192 bytes base64)                         |
| Global editor content cap | 49,152 bytes, further capped by the source field limit   |
| Chunks per transfer       | 8 (ceil(49,152 / 6,144))                                 |
| Active transfers          | 1 inbound + 1 outbound per descriptor                    |
| Transfer lifetime         | 30,000 ms from begin to commit                           |
| Browser message envelope  | 65,536 bytes, measured as UTF-8 JSON bytes               |
| MSDP subnegotiation       | strictly below `MAX_PROTOCOL_BUFFER` (12 KiB)            |
| Digest                    | SHA-256 over the raw (pre-base64) content, lowercase hex |

Chunk data is base64 on both transports so JSON escaping, Telnet/MSDP marker
bytes, and editor commands cannot alter byte accounting or be injected.

A transfer is rejected — with no character mutation — when it is duplicate,
missing a chunk, out of order, stale against the current revision, oversized,
invalid UTF-8, contains disallowed control characters, or fails its digest.
Line endings are normalized and tilde/control handling matches the terminal
editor, through shared source code rather than a browser reimplementation.

Buffers are cleared and overwritten on every success, rejection, timeout, state
transition, fallback, disconnect, account switch, and character switch.

Editor commits are rate-limited separately from small onboarding actions, on
both an action count and a byte budget.

### 5. Checked persistence

Add to the source:

```c
bool save_char_checked(struct char_data *ch, int mode);
void save_char(struct char_data *ch, int mode);  /* legacy wrapper */
```

The current implementation moves behind `save_char_checked()`; every early
allocation, open, write, flush, close, and index failure becomes `false`.
`save_char()` stays as a result-discarding wrapper so no call-site migration is
forced.

Every structured role-play commit must: snapshot the affected character and
index fields, revalidate, apply through the shared domain helper, call
`save_char_checked()`, restore the snapshot if mutation or save fails, emit a
bounded safe error with a new revision on failure, and emit durable success only
on `true`.

`persistenceResult="saved"` is not self-certifying. Reload assertions prove the
accepted data survives a fresh character load.

### 6. Privacy

Profile text, character names, and selections must not appear in logs,
analytics, command history, aliases, triggers, local storage, service-worker
caches, test recordings, screenshots, or committed fixtures. Metrics are
aggregate only: screen, action, error code, size bucket, latency. Error messages
never echo a submitted value.

### 7. Permanent availability amendment

The initial rollout used independent gateway and source switches. A routine
source configure/build later omitted the source definition and silently
downgraded production to v1, removing the RP UI while every component still
looked healthy.

Those switches are removed. Current gateways always advertise `2,1`; current
source builds always include v2 and reject the retired compiler definition.
Release rollback restores a previous complete release rather than disabling a
fundamental product capability.

## Consequences

**Enables.** The role-play suite can stay structured while Luminari-Source keeps
sole authority over options, restrictions, mutation, and persistence. Existing
field limits are preserved rather than truncated. The browser can honestly
distinguish in-memory acceptance from durable save.

**Prevents.** No profile text can reach the MUD as terminal commands. No partial
transfer can mutate character data. No success message can precede a checked
save.

**Costs.** Two protocol versions must be parsed and tested for the duration of
the rollout. The chunked transfer adds descriptor-local state to the source and
session-local state to the gateway, each with its own lifecycle-clearing
obligations.

**Follow-up.** This ADR did not itself resolve `ONBOARD-SEC-001` (the former
plaintext upstream gateway-to-MUD web leg), so it was originally a separate
release gate. The managed-mTLS origin, exact-path Apache proxy, and
loopback-only Node/MUD route resolved it on 2026-07-29. See the
[transport architecture](../ARCHITECTURE.md#managed-mtls-origin-decision) and
[closure evidence](../SECURITY-COMPLIANCE.md#onboard-sec-001-closure-evidence).
