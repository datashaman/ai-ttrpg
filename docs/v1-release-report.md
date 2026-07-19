# v1 Solo Play Release Report

Date: 2026-07-19

Scope: locked-manor Solo Play vertical slice from issue #1, verified by issue #12.

## Release decision

**Pass.** Automated correctness, replay, input-mode equivalence,
model-authority, failure-recovery, and applicable terminal-accessibility gates
pass. A new human Player also completed the Adventure without external
documentation in a moderated session.

## Automated gate evidence

The repository test command is the release gate. Its canonical scenarios cover:

| Required scenario | Automated evidence |
| --- | --- |
| Free Action | `scripted Structured Play configures, starts, and completes a Free Action` |
| Check | seeded Setback, Success with Cost, and Clean Success runner scenarios |
| Contested Action | `Structured Play completes a visible Confrontation victory without an opposed roll` |
| Resolve spend | `scripted Structured Play spends Resolve after the roll is revealed` |
| Inventory Item use | `Structured Play runs item recovery and distinct Condition lifecycles end to end` |
| Confrontation exchange | Confrontation victory, Danger Clock Defeat, and zero-Health Defeat runner scenarios |
| Oracle question | `scripted Structured Play visibly establishes a seeded Oracle answer after Player correction` |
| Invalid command | invalid rating reprompt and unavailable-action rejection scenarios |
| Pending Choice restoration | `scripted Structured Play resumes a persisted Pending Choice without rerolling` |
| Timeline branch | branching, source preservation, selection, and inherited-randomness scenarios |
| Rules query | natural-language and presentation rules-query scenarios |
| Scene transition | automatic transition, skipped Scene, favourable ending, and Defeat consequence scenarios |

Replay fixtures compare normalized projections after rebuilding from canonical
events for Player-visible state, Check resolution, Oracle resolution,
Confrontation state, Conditions, Scene lifecycle, Pending Choice interruption,
presentation regeneration, and Timeline reconstruction. Branch fixtures also
prove that the source Timeline stays byte-equivalent and that a child inherits
the source random-stream position.

The two complete successful routes now compare normalized canonical events
between natural-language and Structured Play for equivalent confirmed choices:

- a non-Confrontation ending through social discovery;
- a Confrontation ending through two Contested Actions.

Structured Play completes an Adventure without a model dependency. Interpreter
and Narrator error, timeout, invalid schema, hidden-fact reference, unavailable
capability, model-authored clarification, and Mechanical Effect injection all
leave canonical state unchanged. Presentation failure returns the committed
deterministic mechanical summary, and repeated regeneration leaves events and
projections byte-equivalent.

## Selected text-play accessibility baseline

The v1 interface is a terminal text flow, not a graphical web interface. Its
applicable baseline is:

- every operation is available through sequential keyboard input;
- setup, action, Check, Pending Choice, Oracle, and error prompts include text
  labels and instructions suitable for linear screen-reader reading;
- status and outcomes never depend on colour, cursor position, animation, or
  sound;
- there are no input time limits or motion effects;
- output uses ordinary text and line breaks without ANSI cursor/control codes,
  leaving contrast, zoom, font choice, and responsive wrapping to the Player's
  terminal and assistive-technology configuration.

The core text-play accessibility contract is automated. Setup now explains the
one-time Trait assignment and reprompts after invalid identity or rating
combinations, allowing the Player to recover without consulting the README.
Normal play presents concise mechanical summaries rather than raw canonical
event and projected-state JSON; audit data remains in the event store, while
Timeline controls retain accepted event positions and types for branching.

## Moderated new-Player completion protocol

The participant must be a new human Player who has not read the repository
documentation.

1. Give the participant only a terminal in the repository with dependencies
   installed and run `npm start`.
2. Ask them to complete the locked-manor Adventure using only interface text.
3. The moderator may ask the participant to think aloud but must not explain
   rules, choices, or valid inputs.
4. Record completion, ending, elapsed time, invalid-input count, requests for
   help, accessibility blockers, and—when collected—an optional 1–5 rules-trust
   rating.
5. Pass when the Player reaches any authored Adventure ending without external
   documentation or moderator instruction and no accessibility blocker prevents
   completion.

### Result record

| Field | Result |
| --- | --- |
| Participant | New human Player |
| Completion and ending | Completed; favourable `sister-escaped-safely` ending |
| Elapsed time | 4 minutes |
| Invalid inputs | 0 observed in the transcript |
| Help requests | 0 |
| Rules-trust rating | Not recorded |
| Accessibility blockers | None prevented completion |

The participant reported that raw canonical events displayed in-stream were
distracting. The release candidate was changed to keep those events out of the
normal play transcript, and the accessibility contract now has a regression
test for this behavior. See the [redacted session record](evidence/v1-moderated-session.md).

## Parent-spec completion gates

All v1 gates in issue #1 are satisfied: both input modes converge on the same
deterministic application behavior; all canonical fixtures replay; Pending
Choices and Timelines recover exactly; model failures remain playable; model
output cannot commit state; and a new human Player completed the Adventure
without documentation.

## Deferred criteria

- None for the v1 completion gate. A quantitative rules-trust rating was not
  collected and remains a follow-up experience metric rather than a binary v1
  completion criterion.
