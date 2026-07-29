# 0001. Terminal Renderer

**Status:** Accepted
**Date:** 2026-05-11

## Context

The current terminal output path renders HTML chunks produced by `ansi-to-html` and inserts them with `dangerouslySetInnerHTML`. This remains acceptable only while XML escaping is centralized and tested. The renderer also carries long-term limits around terminal fidelity, scrollback semantics, copy and selection behavior, resize accuracy, and burst-output performance.

Phase 1 Session 05 added a bounded xterm.js spike behind `?terminalRenderer=xterm-spike`. The spike consumes the same raw terminal stream, keeps the external command input authoritative, disables xterm stdin, normalizes Luminari color codes through the shared renderer helper, and routes fit-derived dimensions through the existing resize path.

## Options Considered

1. Keep `ansi-to-html` as the long-term renderer - lowest immediate risk, but it keeps React-owned terminal HTML chunks and does not address mature terminal behavior.
2. Replace the default renderer with xterm.js immediately - improves long-term direction, but would mix spike validation with production migration and lacks browser-level copy, mobile, focus, and burst-output evidence.
3. Approve a staged xterm.js migration - keeps the current renderer stable now while using the spike evidence to scope a follow-up production migration.

## Decision

Approve option 3. xterm.js is the preferred long-term renderer path, but the default production renderer remains the current escaped `ansi-to-html` path until a follow-up migration session owns the replacement.

The follow-up migration should:

- Remove the default HTML terminal branch only after browser-level renderer checks exist.
- Preserve external command input, command history, aliases, triggers, movement shortcuts, and paste behavior.
- Keep Luminari color conversion shared between any remaining HTML display helpers and xterm writes.
- Preserve NAWS resize lifecycle guards and fit-derived dimension bounds.
- Add browser checks for desktop, 390px mobile width, selection/copy, focus, reconnect reset, and terminal burst output.

## Consequences

This decision allows implementation work to continue toward xterm.js without weakening the current escaped HTML renderer. It prevents an unvalidated renderer swap during the spike session. The remaining risks are browser-selection parity, mobile layout tuning, visual theme fidelity, and performance evidence under large terminal bursts.
