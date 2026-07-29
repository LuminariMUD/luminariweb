# Luminari Web - UX Requirements Document

**Companion to**: [PRD.md](PRD.md)
**Created**: 2026-05-10

---

## 1. Design Brief

### Emotional Targets

**Focused authority + instrument trust + game-aware craft.**

The interface should feel like a well-made cockpit for a text world: every element earns its space by answering one player question. Terminal output is never crowded by decoration. Connection and protocol states are explicit. The dashboard understands character, room, party, combat, and commands instead of acting like a plain shell.

### Aesthetic Identity

- **Reference domain**: Aerospace instrument panels -- mission control displays where every readout has a purpose, information density is high but not chaotic, and status is communicated through disciplined use of signal color on dark surfaces.
- **Era / movement**: Late modern instrumentation meets tabletop character sheet -- the clarity of Swiss International typography with the density of a well-organized RPG character record.
- **Material metaphor**: Black glass and brushed dark metal. The terminal is a dark glass viewport. Dashboard panels are thin metal instrument cards -- sharp, compact, low-profile. Accents are signal lights on a dark console, not decorative glow.

_The intersection: an illuminated command desk. Terminal craft (black glass, crisp mono text, strong cursor) meets tabletop character sheet (compact stats, clear labels, disciplined spacing) meets arcane instrumentation (restrained signal colors used only where the data warrants it)._

### Signature Moment

The room-aware dashboard update: the terminal receives room text, and simultaneously the room card updates area name, room name, exits, and terrain. The map highlights the current position or exit set. The command surface offers contextual actions -- look, exits, scan, rest, stand, group, affects, inventory. In one beat, the product demonstrates it understands Luminari play, not merely wraps a Telnet stream.

### Micro-Narrative

1. **Arrival**: Choose a curated game preset or reconnect to the last route. The connection form is prominent, the terminal is waiting.
2. **Orientation**: See proxy state, selected game, and display mode before typing. The session strip confirms readiness.
3. **Engagement**: Terminal, command input, HUD, and quick actions stay immediately usable. Information flows without interruption.
4. **Inspection**: Panels expose room, character, group, affects, inventory, and protocol data without blocking typing or stealing focus.
5. **Recovery**: Reconnect, timeout, unsupported data, and import/export states are visible and actionable. The player is never stuck wondering what happened.

---

## 2. User Flows

### Flow 1: Connect to Game

**Trigger**: Player opens the client or returns after disconnect
**Goal**: Establish a live connection to a Luminari-compatible MUD

```
[Open Client] --> [See Connection Form + Presets] --> [Select Preset or Enter Custom] --> [Click Connect]
     |                                                                                        |
     v                                                                                        v
  [Resume Last Route]                                                                  [Proxy Connects]
                                                                                              |
                                                                                              v
                                                                                       [MSDP Negotiation]
                                                                                              |
                                                                                              v
                                                                                       [Terminal Active + HUD Live]
```

**Happy path**: Player selects a curated preset, connects, sees login prompt in terminal.
**Error states**: Proxy unreachable (show proxy error), MUD unreachable (show TCP error with route name), MSDP negotiation fails (degrade gracefully, terminal still works).

### Flow 2: Active Play Loop

**Trigger**: Player is connected
**Goal**: Send commands and read game output with live HUD feedback

```
[Read Terminal Output] --> [Type Command] --> [Send via Enter/Button] --> [See Output + HUD Update]
     |                          |                                              |
     v                          v                                              v
  [Scroll Back]           [Use History Up/Down]                         [Room Card Updates]
                          [Use Alias Expansion]                         [Combat State Changes]
                          [Use Movement Shortcut]                       [Affects Refresh]
```

**Happy path**: Player types, sends, reads response, HUD updates. Cycle repeats.
**Error states**: Command fails (MUD error text in terminal), connection drops mid-command (reconnect flow triggers).

### Flow 3: Room Navigation

**Trigger**: Player moves to a new room
**Goal**: Understand current location and available exits

```
[Send Movement Command] --> [Terminal Shows Room Text] --> [Room Card Updates: Name, Area, Exits]
                                                                |
                                                                v
                                                         [Map/Minimap Updates if Available]
                                                                |
                                                                v
                                                         [Contextual Actions: look, exits, scan]
```

**Happy path**: Room data arrives via MSDP, room card and map reflect current position.
**Error states**: Room MSDP not emitted (room card shows "waiting for room data"), minimap unavailable (map degrades to exit-only display).

### Flow 4: Combat Engagement

**Trigger**: Opponent/tank MSDP data appears
**Goal**: Monitor combat state without losing terminal context

```
[Enter Combat] --> [Opponent Bar Appears in HUD] --> [Tank Bar Appears if Grouped]
                         |                                    |
                         v                                    v
                  [HP/PSP Update in Real-Time]         [Quick Actions: flee, rescue, assist]
                         |
                         v
                  [Combat Ends: Bars Clear Quietly]
```

**Happy path**: Combat bars appear when data arrives, disappear when combat ends.
**Error states**: Opponent data stale after disconnect (clear on reconnect), partial data (show what is available).

### Flow 5: Character Inspection

**Trigger**: Player opens character/inspector panel
**Goal**: Review character stats, affects, group, inventory without leaving play

```
[Tap Inspector Tab] --> [Panel Opens Beside Terminal] --> [Read Stats/Affects/Group/Inventory]
                                                                |
                                                                v
                                                         [Return to Terminal: Click/Tap Outside Panel]
```

**Happy path**: Panel shows live MSDP-backed data, player reads and returns to terminal.
**Error states**: Data not yet emitted (protocol-aware empty state explains why).

### Flow 6: Reconnect / Recovery

**Trigger**: Connection drops or player returns after idle
**Goal**: Resume play with clean state

```
[Connection Lost] --> [Reconnect Banner Appears] --> [Player Clicks Reconnect]
                                                           |
                                                           v
                                                    [Proxy Re-Establishes TCP]
                                                           |
                                                           v
                                                    [MSDP Re-Negotiated] --> [HUD/Panels Reset and Rebuild]
```

**Happy path**: Player reconnects, sees login prompt, previous stale state is cleared.
**Error states**: Repeated failures (show error count and last failure reason), idle timeout (show timeout warning before disconnect).

### Flow 7: Settings and Automation Management

**Trigger**: Player opens settings or automation tools
**Goal**: Configure display, controls, aliases, triggers, or protocol mappings

```
[Open Settings] --> [Navigate Grouped Tabs] --> [Change Setting] --> [Apply/Save]
     |                                                                    |
     v                                                                    v
  [Import/Export Config]                                           [Close Settings, Resume Play]
```

**Happy path**: Player adjusts font size, adds an alias, exports config.
**Error states**: Import fails (show parse error), recursive alias detected (show limit warning).

---

## 3. Screen Inventory

| Screen               | Route/Path                       | Purpose                                           | Key Components                                                     |
| -------------------- | -------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| Connection           | `/` (pre-connect state)          | Select preset or enter custom MUD, connect        | Preset selector, host/port fields, connect button, last route chip |
| Play (Desktop)       | `/` (connected state)            | Primary gameplay: terminal + HUD + inspector      | Terminal, command dock, HUD rail, session strip, right inspector   |
| Play (Mobile)        | `/` (connected, narrow viewport) | Touch-optimized gameplay                          | Full-height terminal, bottom command dock, swipe-up sheets         |
| Inspector: Room      | Inspector tab                    | Current room context and map                      | Room name, area, exits, vnum, minimap (when available)             |
| Inspector: Character | Inspector tab                    | Character stats and identity                      | Name, level, race, class, abilities, AC, attack, money, position   |
| Inspector: Combat    | Inspector tab or HUD overlay     | Active combat state                               | Opponent bar, tank bar, quick combat actions                       |
| Inspector: Group     | Inspector tab                    | Party member status                               | Member rows with name, HP, movement, leader marker                 |
| Inspector: Affects   | Inspector tab                    | Active effects and buffs                          | Affect rows with name, duration, modifiers, expiry emphasis        |
| Inspector: Inventory | Inspector tab                    | Carried items and equipment                       | Inventory list with grouping or raw fallback                       |
| Inspector: Quests    | Inspector tab                    | Quest status (deferred)                           | Unavailable state message until structured server data exists      |
| Inspector: Protocol  | Inspector tab                    | Debug and support information                     | Last MSDP vars, variable map, WebSocket state, proxy status        |
| Settings             | Modal/drawer overlay             | Configure display, controls, automation, protocol | Grouped tabs: Display, Controls, Automation, Protocol, Connection  |

---

## 4. Navigation Structure

```
[Session Strip - always visible]
|-- Route/connection state
|-- Latency/last event
|-- Reconnect/disconnect
|-- Settings/tools access
|-- Compact preset selector (pre-connect)
|
[Main Layout]
|-- Terminal Column (primary)
|   |-- Terminal output (scrollable)
|   |-- HUD rail (HP, PSP, Move, EXP, Opponent, Tank)
|   \-- Command dock (input, send, history, quick actions)
|
|-- Right Inspector (desktop) / Bottom Sheets (mobile)
|   |-- Room + Map
|   |-- Character
|   |-- Combat (state-driven, appears when in combat)
|   |-- Group
|   |-- Affects
|   |-- Inventory
|   |-- Quests
|   \-- Protocol
|
\-- Settings (modal/drawer, on demand)
    |-- Display
    |-- Controls
    |-- Automation
    |-- Protocol
    \-- Connection
```

**Navigation pattern**: Session strip (persistent) + inspector tabs (desktop sidebar / mobile bottom sheets) + modal settings overlay.
**Deep linking**: Not applicable for first release. URL-driven preset selection for embed/shared links is a future consideration.

---

## 5. Interaction Patterns

### Command Input

- Single-line input with Enter to send
- Command history via Up/Down arrow keys
- History previous/next buttons on touch layouts
- Alias expansion on send
- Movement shortcuts excluded from command history
- Click-anywhere focus returns to command input
- Password mode label when echo is hidden (server-driven)
- Tab completion for known commands

### Forms (Settings, Aliases, Triggers)

- Validation: inline validation for alias/trigger patterns and MSDP variable names
- Error display: inline error messages below the invalid field
- Success feedback: brief confirmation toast on save/import
- Destructive actions (delete alias, clear settings): confirmation dialog

### Inspector Panels

- Tab-based switching on desktop (right sidebar)
- Bottom sheet on mobile (swipe-up or tap to expand)
- Panels never steal focus from command input unless explicitly opened
- Panels update in real-time from MSDP state without requiring manual refresh
- Panel content remains visible when switching between tabs (no re-fetch)

### Modals/Dialogs

- Settings: full modal/drawer with grouped tabs
- Import/export: file picker dialog
- Confirmation: destructive actions only (disconnect, delete automation, clear settings)
- Modals close on Escape and overlay click

### Loading States

- Terminal: cursor or "Connecting..." text in terminal area
- HUD bars: empty/zero state with muted color until first MSDP update
- Inspector panels: protocol-aware empty states (not generic spinners)

### Notifications

- Connection state changes: inline banner in session strip
- Reconnect: persistent banner until resolved
- Import success/failure: toast notification (auto-dismiss after 3s)
- Idle timeout warning: banner before disconnect
- No notification should overlay the terminal output area

---

## 6. Motion and Animation Strategy

### Philosophy

Motion serves wayfinding and status feedback only. Gameplay text must never be delayed by decorative animation. Every animation must justify its existence by communicating state change.

### Entrance Choreography

- Page load: immediate render, no staggered reveals. The terminal and connection form appear instantly.
- Panel open/close: fast slide (150-200ms) with ease-out. Inspector panels slide in from the right (desktop) or up from the bottom (mobile).
- HUD bar value changes: smooth width transition (200ms ease-out) for resource bars.

### Interaction Feedback

- Hover states: subtle background lightening on interactive elements. No scale transforms on primary controls.
- Click/tap responses: brief opacity pulse (100ms) on buttons. Command send shows brief input flash.
- Focus rings: 2px solid ring using semantic accent color (teal for navigation, neutral for general). Visible, not just purple glow.

### Scroll-Driven Moments

- None for first release. Terminal auto-scroll is the primary scroll behavior. No parallax, no scroll-triggered transformations.

### Animation Constraints

- Maximum 2 elements animating simultaneously per viewport region
- No animations longer than 300ms for UI state changes
- No linear easing -- use ease-out or cubic-bezier(0.25, 0.1, 0.25, 1.0)
- Respect `prefers-reduced-motion`: disable bar transitions and panel slides, use instant state changes instead
- Target 60fps -- bar transitions and panel slides must not cause layout thrash
- Terminal append must stay under 100ms perceived latency for bursts up to 50 messages/second
- Avoid permanent `will-change` on any element

---

## 7. Layout Philosophy

### Composition Approach

Dense and information-rich, but hierarchically disciplined. The terminal dominates. Dashboard panels are compact instrument cards -- high information density within small footprints. The layout should feel like a command station: every pixel either shows game state or provides a control surface.

### Visual Hierarchy

- Scale contrast: terminal output is the largest visual element by far. HUD bars are compact but always visible. Inspector panels are secondary -- present but not competing.
- Negative space: minimal around controls and data (instrument density), generous around the terminal viewport (reading space). No decorative padding between functional elements.
- Section rhythm: fixed zones. The terminal column does not change height based on content. Inspector panels scroll internally. The HUD rail is fixed height.

### Section Transitions

Hard cuts between zones. Terminal, HUD, and inspector are distinct regions separated by thin borders or 1-2px gaps, not gradients or overlap zones. The session strip is a single-line permanent header. No bleeding between sections.

---

## 8. Responsive Strategy

| Breakpoint  | Target                       | Layout Approach                                                                                                                                    |
| ----------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| < 360px     | Narrow mobile (smoke target) | Full-height terminal, bottom command dock, no inspector visible by default. Core connect/terminal/input must work.                                 |
| 360-389px   | Narrow mobile                | Same as above with slightly more breathing room. Smoke coverage for UI changes.                                                                    |
| 390-767px   | Primary mobile (390x844)     | Full-height terminal, compact session chip, bottom command dock with send/history, swipe-up inspector sheets, optional movement pad behind toggle. |
| 768-1023px  | Tablet (768x1024)            | Terminal with collapsible right inspector. HUD visible. Command dock at bottom. Inspector can be toggled on/off.                                   |
| 1024-1279px | Small desktop                | Terminal + narrow right inspector always visible. Full HUD rail. Session strip with route details.                                                 |
| >= 1280px   | Desktop (1280x720, 1440x900) | Full terminal column + right inspector + full HUD rail + session strip. Room/map panel prominent in inspector.                                     |

**Approach**: Mobile-first for layout structure, desktop-enhanced for panel density.
**Touch targets**: Minimum 44x44px for all interactive elements on mobile command surfaces, with generous spacing between adjacent targets.
**No horizontal scroll**: Core connect, terminal, command input, and HUD must never cause horizontal page scrolling at any supported width.

---

## 9. Accessibility

**Target**: WCAG 2.1 AA

- **Keyboard navigation**: Every control must be keyboard reachable. Tab order follows visual layout: session strip, terminal, command input, HUD, inspector tabs, inspector content, settings.
- **Screen reader**: Semantic HTML for all controls. `aria-controls` and stable `id` attributes for tab buttons and tab panels. `aria-live` regions for connection state changes and HUD value updates. Terminal output region marked as a log or `aria-live="polite"`.
- **Color contrast**: WCAG AA minimum (4.5:1 for normal text, 3:1 for large text). HUD bars and status indicators must include text labels alongside color -- never color alone.
- **Focus management**: Visible focus rings using semantic accent colors (2px solid, not just purple glow). Focus returns to command input after modal/panel close. Focus trap inside open modals.
- **Reduced motion**: `prefers-reduced-motion` disables panel slide animations, bar width transitions, and any future decorative motion. State changes happen instantly. No content is hidden behind animation-only reveals.
- **Touch accessibility**: 44px minimum touch targets on mobile. Movement pad buttons sized from a physical touch standard. No gesture-only interactions without button alternatives.
- **Disclosure semantics**: Review top menu `role="menubar"` usage. If controls are disclosure buttons, use simpler button/disclosure semantics rather than a full menu bar.
- **Password safety**: Never store or export passwords. No command logging by default.

---

## 10. Design System

### Color Architecture

- **Dominant surface** (60%): Near-black terminal background (`#0a0a0f` to `#111118` range). The dark glass viewport. All panels use dark surfaces in the same family.
- **Secondary surfaces** (25%): Slightly elevated dark panels (`#16161e` to `#1c1c26` range). Inspector cards, HUD background, session strip. Relate to dominant through value, not hue.
- **Accent** (10%): Semantic gameplay signals, not decorative brand color. ONE visible accent element at a time per viewport region.
- **Signal colors** (5%): Functional and on-brand:
  - Health/danger: `hsl(0, 70%, 55%)` -- warm red
  - PSP/magic: `hsl(195, 70%, 55%)` -- clear cyan
  - Movement/stamina: `hsl(140, 60%, 50%)` -- natural green
  - Experience/progress: `hsl(42, 80%, 55%)` -- warm gold
  - Combat active: `hsl(20, 80%, 55%)` -- alert orange
  - Navigation/room: `hsl(175, 60%, 50%)` -- teal
  - Protocol/connection: `hsl(220, 15%, 55%)` -- neutral slate
  - Error: `hsl(0, 65%, 50%)`
  - Warning: `hsl(38, 80%, 55%)`
  - Success: `hsl(140, 55%, 45%)`

**Palette character**: COOL, SYNTHETIC, QUIET. Dark glass with disciplined signal light. Avoid the current purple accent. Avoid warm wood, parchment, or fantasy ornamental palettes.

### Typography

- **Display font**: Not needed for this product. Section headers use the body font at larger weight.
- **Body font**: A clean, legible sans-serif with character. Inter, IBM Plex Sans, or similar with strong small-text readability. The quiet partner to terminal mono.
- **Monospace**: The terminal's personality carrier. JetBrains Mono, Fira Code, or IBM Plex Mono. Must render ANSI art and MUD output clearly at 14-18px. User-configurable (existing setting).
- **Scale ratio**: 1.25 (minor third). Body 16px, small 13px, label 14px, heading 20px, large heading 25px.
- **Minimum body size**: 16px on desktop, 16px on mobile (prevents iOS zoom on input focus).

### Spacing Scale

4px, 8px, 12px, 16px, 24px, 32px, 48px, 64px.

Use 4px for tight instrument spacing within panels. 8px for standard element gaps. 16px for section padding. 24-32px for major zone separation. Controls and panels should feel compact, not airy.

### Elevation and Depth

Flat with sharp borders. No soft drop shadows. Depth communicated through surface color value steps (darker = further back, lighter = elevated). Thin 1px borders (`hsl(220, 15%, 20%)`) separate zones. The terminal area sits at the lowest elevation (darkest). Inspector panels are one step up. Modals are two steps up with a dark scrim overlay.

No frosted glass, no blur, no transparency effects on functional surfaces. Clean separation.

### Texture and Atmosphere

Minimal. No gradients, noise, or geometric patterns on functional surfaces. The terminal background is flat black or near-black. Panel backgrounds are flat dark. The only atmospheric element is the terminal text itself -- ANSI colors, scrolling output, and cursor blink provide all the visual energy the interface needs.

Remove the current radial gradient background. Replace with flat surface colors.

---

## 11. Component Patterns

| Component                  | Used In                                         | Behavior                                                                                                          |
| -------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Session Strip              | All screens (persistent)                        | Shows route, connection state, latency, reconnect control. Collapses to chip on mobile.                           |
| Terminal Viewport          | Play screen (primary)                           | Scrollable ANSI output. Auto-scroll with manual override. Click-to-focus returns to command input.                |
| Command Dock               | Play screen (bottom)                            | Input + send + history + optional quick action toggle. Password mode label. Always visible.                       |
| HUD Rail                   | Play screen (below terminal or beside)          | HP, PSP, Movement, EXP bars with text labels. Opponent/tank bars appear during combat.                            |
| Resource Bar               | HUD Rail                                        | Horizontal fill bar with numeric label. Semantic color. Width transitions on value change.                        |
| Inspector Panel            | Right sidebar (desktop) / bottom sheet (mobile) | Tabbed container for Room, Character, Group, Affects, Inventory, Quests, Protocol.                                |
| Room Card                  | Inspector: Room tab                             | Room name, area name, exits (directional), vnum. Map/minimap below when available.                                |
| Character Sheet            | Inspector: Character tab                        | Dense instrument layout: identity row, resources, abilities grid, combat stats, money/position.                   |
| Combat Overlay             | HUD + Inspector                                 | Opponent and tank bars in HUD. Combat tab in inspector with quick actions. State-driven visibility.               |
| Group Row                  | Inspector: Group tab                            | Member name, HP, movement, leader marker. Compact layout. Missing values handled gracefully.                      |
| Affect Row                 | Inspector: Affects tab                          | Name, duration, modifiers. Expiring-soon emphasis. Fallback to raw text for unknown shapes.                       |
| Inventory List             | Inspector: Inventory tab                        | Grouped items or raw structure fallback. Scrollable.                                                              |
| Protocol-Aware Empty State | All inspector panels                            | Contextual message explaining why data is absent: server unsupported, not yet emitted, mapping disabled, loading. |
| Movement Pad               | Command dock (optional, toggle)                 | Cardinal + diagonal + up/down/in/out grid. 44px+ touch targets. Collapsed by default on desktop.                  |
| Action Palette             | Command dock (optional)                         | Quick commands: look, exits, score, inventory, affects, group. Saved aliases. Recent commands.                    |
| Settings Modal             | Overlay                                         | Grouped tabs: Display, Controls, Automation, Protocol, Connection. Save/cancel/import/export actions.             |
| Connection Form            | Pre-connect state                               | Preset dropdown, host/port fields, connect button. Prominent before connect, collapses to session strip after.    |
| Connection Chip            | Session strip (post-connect)                    | Compact route name + status indicator. Tap to expand reconnect/disconnect options.                                |
| Toast Notification         | Overlay (bottom or top)                         | Auto-dismiss after 3s. Import success/failure, setting saved, export complete.                                    |
| Reconnect Banner           | Session strip area                              | Persistent until connection restored or dismissed. Shows attempt count and last error.                            |

---

## 12. Anti-Patterns to Avoid

1. **No decorative purple**: The current slate/purple AI-demo aesthetic is explicitly wrong for this product. Every accent color must come from gameplay semantics (health, magic, movement, navigation, combat), not brand decoration.

2. **No terminal-obscuring chrome**: Dashboard panels, settings, menus, and notifications must never cover or reduce the terminal viewport during active play unless the player explicitly opens an overlay. The terminal is the primary work surface.

3. **No generic empty states**: "No data reported yet" is banned. Every empty state must be protocol-aware: name the missing MSDP variable, explain whether the server doesn't emit it, the mapping is disabled, or data hasn't arrived yet.

4. **No shrunken desktop for mobile**: Mobile is not a collapsed desktop layout. Mobile gets its own command dock, bottom sheets, movement pad, and touch-sized controls. Avoid just making the desktop sidebar narrower.

5. **No fantasy ornament**: The aesthetic is aerospace instrumentation, not fantasy game UI. No parchment textures, ornate borders, fantasy fonts, decorative scrollwork, or themed card frames. The game provides the fantasy; the interface provides the instruments.

---

## 13. Resolved UX Defaults

These defaults are decided for implementation unless a later session uncovers a hard technical constraint.

1. **Terminal font default**: Use JetBrains Mono as the preferred terminal font when bundled or available, then fall back to Fira Code, IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, and monospace. Keep the existing user setting so players can override the stack.

2. **Inspector default tab**: Default to Room on desktop because it is the signature game-aware panel and the most useful companion to movement. On mobile, keep the inspector collapsed by default and open to Room when expanded.

3. **Combat quick actions**: Ship a conservative default set: look, consider, assist, rescue, flee, group, and affects. Treat these as editable command shortcuts, not fixed combat automation. Never trigger combat actions automatically.

4. **HUD rail position**: Keep the HUD rail between the terminal viewport and the command dock for the first dashboard pass. This preserves the current layout, keeps state close to command entry, and avoids introducing a new side rail before the room/inspector work stabilizes.

5. **Mobile movement pad**: Put the movement pad behind an explicit toggle by default. The terminal and command input keep priority on small screens; players who move primarily by touch can keep the pad open during a session.

6. **Desktop layout persistence**: Do not introduce draggable panels in the first UX implementation. Start with a stable CSS grid plus a persisted inspector width/collapsed state. Revisit dockable panels only after room, HUD, and protocol panels are stable.

7. **PWA timing**: Defer installable PWA work until the core mobile command dock and reconnect states are verified. PWA polish should not block the first protocol-aware dashboard.

---

## 14. UX Acceptance Checklist

Every UI-focused session should pass these checks before it is considered complete:

1. **Terminal priority**: At 390x844, 768x1024, 1280x720, and 1440x900, terminal output remains the largest active surface and is not obscured by menus, notifications, or inspector panels unless the user explicitly opens an overlay.

2. **Command readiness**: After connect, disconnect, panel close, settings close, and toast dismissal, focus returns to the command input or the next intended keyboard target. Enter sends exactly one command.

3. **Protocol-aware empty states**: Room, map, character, group, affects, inventory, quest, and protocol panels distinguish at least four states where applicable: not connected, waiting for first update, server does not emit this variable, and client mapping disabled.

4. **Responsive no-scroll guarantee**: Core connect, terminal, HUD, command input, and primary navigation must not create horizontal page scroll at 360px, 390px, 768px, 1024px, or 1280px viewport widths.

5. **Accessibility baseline**: New controls have semantic labels, visible focus rings, keyboard access, and non-color text labels for resource/status values. Tabs use stable `aria-controls` and matching panel ids.

6. **Motion and performance**: Terminal append remains responsive during burst output. UI transitions stay under 300ms, are disabled by `prefers-reduced-motion`, and do not animate layout-heavy properties in loops.

7. **Visual identity guardrail**: New UI work uses flat dark surfaces, thin borders, and semantic signal colors. It must not reintroduce purple decoration, radial gradient backgrounds, parchment/fantasy ornament, nested cards, or terminal-obscuring chrome.
