# Use a Browser-First Local Alpha Interface

Milestone C needs an accessible Player Interface and Game Master control
surface without making presentation a new authority over game state. The alpha
will use a client-rendered React and TypeScript single-page application built
with Vite and React Router, served by a local Node.js 24 process. This keeps the
interface replaceable, makes browser accessibility testing practical, and
preserves the existing application and actor-scope boundaries.

## Runtime and support boundary

The release-gated host is current macOS running Node.js 24. The supported
clients are the current stable Safari, Chrome, Firefox, and Edge releases on
that host; previous browser majors and other operating systems are best-effort.
The application is responsive from 320 CSS pixels upward. Genuinely
two-dimensional Timeline graphs and tables may use labelled scrolling where
WCAG permits it, but actions cannot depend on hover or a desktop-only layout.

The alpha is a trusted, local deployment. It has no hosted authentication. A
local session selects either Player or Game Master scope, and the server binds
every query and command to that session rather than accepting an actor override
from the client. A hostile or multi-user deployment requires an authentication
adapter before it is supported.

All interface assets are bundled locally. Structured Play, projections,
Timelines, evidence inspection, and Game Master intervention remain available
without internet access or a model provider. Model-backed presentation reports
itself as unavailable and offers Structured Play. The alpha does not require a
service worker or installable PWA because the local Node process is its host.

## Rendering and navigation

The application uses client-side rendering, semantic HTML, plain CSS with
design tokens and locally scoped styles, and no initial full visual component
suite. It does not use server-side rendering, React Server Components, a native
shell, or Electron.

Player and Game Master workspaces have separate route trees. Adventure and
Timeline identities are encoded in the URL, and each route loads only its
actor-scoped projection. Shared components may render both surfaces, but
privileged data must never be fetched and then hidden in the browser. Durable
detail views use routes; transient confirmations and Pending Choices use
labelled inline regions or dialogs.

The Player workspace is Scene-first: its primary feed presents committed
outcomes, one shared input area offers Natural Language Play and Structured
Play, and a Pending Choice replaces ordinary input until resolved. Character
resources, Inventory Items, Conditions, Clocks, and Scene status use a compact
side panel that stacks below the feed at narrow widths. Evidence and resolution
traces expand from mechanic summaries, while Timeline and branching work lives
on secondary routes.

The Game Master workspace is queue-first. Ambiguous input, invalid State
Proposals, rule conflicts, and Rule Reviews appear as intervention work. An
item's detail view correlates Player input, proposal, validation findings,
Evidence Bundle, applicable rule, Model Call Record, command, and accepted
events. Approve, edit, reject, and override controls submit validated
application commands. Adventure state, World Knowledge, rules, Timelines, and
branch comparison use secondary routes. Narration links to its trace so an
outcome's reason is reachable within three interactions.

Both workspaces use the same explicit statuses: `Committed`, `Action required`,
`Under review`, `Processing`, `Provisional`, `Recoverable error`, and
`Unavailable`. Status uses text and semantics rather than colour alone. Raw
provider diagnostics remain hidden unless local diagnostic capture was
explicitly enabled.

## Application and state boundary

React code depends on one typed `ApplicationClient` contract. It exposes
actor-scoped projection queries, validated command submission, presentation
stream subscription, evidence and trace queries, Timeline operations, and Game
Master intervention commands. Components do not call repositories, event
stores, model providers, or raw `fetch` directly. The production adapter uses
JSON HTTP for commands and queries and Server-Sent Events for presentation; a
deterministic in-memory adapter supports tests.

Server projections remain authoritative. Browser caches are disposable, URLs
own selected identities, and component state is limited to drafts, disclosure,
and focus. The client does not optimistically show a submitted command as
committed and does not duplicate domain state in a Redux-style store. A command
response replaces or invalidates the affected projections.

## Streaming and accessibility

A command commits before Narration streaming begins. Every Server-Sent Event
carries a stream ID, correlation ID, monotonically increasing sequence, and a
`segment`, `completed`, or `failed` type. Segments render only as provisional
presentation. `completed` identifies the retained presentation, which replaces
the provisional content. Disconnects, cancellation, malformed sequences, and
failures discard provisional text and reveal the deterministic committed
summary. Retrying presentation reuses the same immutable snapshot and cannot
resubmit a command or change game state. WebSockets are deferred until a later
bidirectional real-time requirement justifies them.

Core Player and Game Master workflows target WCAG 2.2 Level AA. Release
evidence combines automated checks with keyboard-only journeys, VoiceOver and
Safari review, visible focus, logical focus restoration, sufficient contrast,
200 percent zoom and reflow, reduced motion, and responsive layouts. Route
changes focus the page heading; Pending Choices focus their labelled decision
region; recoverable errors focus a summary containing the next action; new feed
entries never steal focus. Stream chunks and protocol events are not announced
or displayed individually. Completion announces a concise status, and reduced
motion disables animated insertion and typewriter effects.

Provisional and retained presentation segments have stable IDs, speaker or
source labels, ordering, and status. They render through a semantic transcript
region and leave extension points for timing and audio-track references. Phase
12 may use those fields for captions without requiring empty audio or caption
controls in the alpha.

## Verification and replacement

Pure view-model and `ApplicationClient` contract tests continue to use
`node:test`. Playwright verifies observable browser journeys, focus,
responsiveness, interrupted streams, and actor isolation against deterministic
fakes, with a smaller contract suite against the real HTTP and Server-Sent
Events adapters. Chrome, Firefox, and Edge journeys are automated. Playwright
WebKit provides early compatibility feedback, while current Safari is verified
manually because WebKit automation is not Safari. Axe checks supplement rather
than replace keyboard and VoiceOver evidence. Tests avoid component internals,
CSS structure, brittle DOM snapshots, exact generated prose, and pixel-perfect
screenshots as release gates.

`ApplicationClient` and its data-transfer shapes are the replacement seam. The
HTTP and Server-Sent Events protocol is private to the alpha and may evolve
with coordinated client and server changes; a compatibility handshake fails
clearly when their versions differ. A hosted deployment can replace the
transport and local-session adapters, and another rendering framework can
replace React, without changing domain rules. Server-owned persisted state uses
explicit schema migrations, while disposable browser caches are invalidated
rather than migrated.

## Considered alternatives

Server rendering and React Server Components add deployment and state-boundary
complexity without helping the local text-first alpha. WebSockets add a
bidirectional lifecycle before the product needs multiplayer or real-time
collaboration. Electron, native applications, and an installable PWA expand the
packaging surface before browser workflows are proven. A broad operating-system
and historical-browser matrix would consume the alpha's evidence budget without
improving its central demonstration. Client-owned domain stores and direct
engine imports would make committed truth ambiguous and couple the interface to
infrastructure, so they are explicitly rejected.
