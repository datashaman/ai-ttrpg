# AI TTRPG Interface System

## Direction

Design for a Solo Player who needs to understand the current Scene, make one
consequential choice, and trust what became committed without reading external
documentation. The interface should feel like a calm, precise Adventure folio:
literary enough to belong to the fiction, but explicit about mechanics,
authority, and recovery.

Domain vocabulary includes Scene, Player Character, authored action, Check
Proposal, Pending Choice, committed outcome, rule trace, Evidence Bundle,
Inventory Item, Condition, Clock, and relationship.

The color world comes from the locked manor: parchment, soot-black ink, aged
brass, oxblood wax, mossed stone, and lantern amber. Oxblood identifies primary
action and authored emphasis; moss identifies committed status; lantern amber
marks attributable detail; blue is reserved for keyboard focus.

The signature pattern is the **Scene ledger**: a chronological, numbered record
of committed outcomes with deterministic presentation, mechanic resolution,
and Evidence Bundle references folded directly beneath each entry.

Avoid generic dashboard conventions:

- Replace a colored application sidebar with an Adventure folio on the same
  parchment canvas, separated by a quiet rule.
- Replace metric-card grids with character marginalia and chronological Scene
  outcomes.
- Replace a game HUD with semantic text, native meters, explicit statuses, and
  inspectable traces.

## Foundations

- **Depth:** borders-only. Use low-opacity rules and small surface shifts; do not
  introduce shadows or floating-card depth.
- **Spacing:** 4px base unit. Prefer 8, 12, 16, 20, 24, 32, 36, 48, 64, 72,
  and 96px values according to hierarchy.
- **Surfaces:** `--parchment` is the canvas, `--parchment-raised` contains
  decisions, and `--parchment-inset` receives form input.
- **Text:** `--soot` primary, followed by `--ink-secondary`,
  `--ink-tertiary`, and `--ink-muted`.
- **Borders:** `--iron-soft`, `--iron-line`, and `--iron-strong` progress from
  quiet grouping to interactive emphasis.
- **Radius:** 3px controls and 6px larger containers. Status pills may use a
  fully rounded radius because their compact shape communicates state.
- **Typography:** Charter/Iowan Old Style/Georgia for Scene, character, and
  outcome headings; system sans-serif for controls and operational text;
  SFMono/Consolas for ratings, rules, calculations, IDs, and evidence.
- **Assets:** remain locally bundled. Do not add remote fonts, icons, or visual
  dependencies.

The implemented token source of truth is
`player-ui/src/styles.css`. Extend those named primitives instead of adding
unrelated color values to components.

## Reusable patterns

### Scene workspace

The active Scene leads the main column. The Scene ledger follows, then the
current Structured Play decision. The Player Character folio occupies the side
rail at wider widths and moves below the complete Scene feed at 720px and
narrower. Preserve usable reflow from 320 CSS pixels.

### Character folio

Keep identity, Motivation, Health, Resolve, Traits, Inventory Items,
Conditions, Clocks, and relevant relationships visibly separate. Use compact
lists and native meters rather than decorative stat cards. Empty mechanical
sections remain labelled and say `None`, `None active`, or `None established`.

### Scene ledger entry

Each entry has a stable turn number, authored action label, textual `Committed`
status, explicit presentation source, outcome summary, and a native disclosure
labelled `Inspect mechanic and evidence`. Keep rule IDs, calculations, and
Evidence Bundle references collapsed by default.

### Decisions

Check Proposals, Oracle confirmations, and Pending Choices share one bordered,
raised decision surface. Use `Action required` text, expose the complete stakes
or recommendation before confirmation, and replace ordinary action input while
a Pending Choice exists. Never imply a roll can be repeated.

### Actions and status

Structured Play actions are text-first buttons: authored label first, action
kind second. Primary confirmation uses oxblood; ordinary alternatives remain
on parchment. Status is always written in text and never conveyed by color
alone. Required interaction states are default, hover, active, focus, disabled,
loading, empty, and recoverable error.

### Focus and recovery

Route and Scene changes focus the page heading. Pending Choices and Oracle
confirmations focus their labelled decision region. Recoverable errors focus a
single summary that states the failure and next action while preserving safe
draft input. New ledger entries do not steal focus.

## Component checkpoint

Before adding or changing a component, state and honor:

- **Intent:** which Player or Game Master task is being completed and how it
  should feel.
- **Palette:** which manor-world semantic colors are needed and why.
- **Depth:** borders-only.
- **Surfaces:** canvas, raised, or inset.
- **Typography:** literary heading, operational body, or mechanical monospace.
- **Spacing:** 4px base unit.

New UI must continue to respect ADR-0014: components depend only on the typed
`ApplicationClient`; server projections remain authoritative; actor filtering
occurs before rendering; partial presentation is never committed state; and
accessibility behavior is tested through public browser journeys.
