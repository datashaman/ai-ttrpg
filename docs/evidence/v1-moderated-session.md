# v1 Moderated New-Player Session

Date: 2026-07-19

This is the redacted evidence record for the human completion gate in issue
#12. The participant confirmed they could run the exercise under the supplied
new-Player conditions: use only the terminal interface, do not consult project
documentation or source, and report any need for moderator help. The moderator
provided no gameplay or rules instruction.

## Result

| Measure | Observation |
| --- | --- |
| Completion | Completed without external documentation |
| Adventure ending | Favourable: `sister-escaped-safely` |
| Elapsed time | 4 minutes |
| Invalid inputs | 0 observed |
| Moderator help | 0 requests |
| Accessibility blockers | None prevented completion |
| Rules-trust rating | Not collected |

## Redacted interaction record

The raw transcript was supplied to the moderator and included canonical event
identifiers, timestamps, and full projected-state dumps. Those implementation
records are omitted here; the Player choices and observable milestones are
preserved below.

1. Created Player Character “Moo” with he/him pronouns, Motivation “Intense
   curiosity,” and Might 0, Wits 2, Presence 1.
2. Chose to cut away the side-door vines, confirmed the Check Proposal, rolled
   a Clean Success, and spent one Resolve.
3. Used the Field Kit to restore Resolve.
4. Inspected the dark entryway, confirmed the Check Proposal, rolled a Clean
   Success, and declined to spend Resolve.
5. Picked the side-door lock, confirmed the Check Proposal, rolled a Success
   with Cost, and spent one Resolve.
6. Chose the visible Scene transition into discovery.
7. Questioned the housekeeper, confirmed the Check Proposal, spent one Resolve
   to reach a Clean Success, and received the favourable
   `sister-escaped-safely` Adventure ending.

## Finding and disposition

The participant reported: “the events displaying in-stream were distracting.”
The release candidate was changed so normal text play keeps canonical event and
full projected-state JSON out of the transcript while retaining concise rules,
roll, outcome, fact, resource, Clock, and ending information. Automated tests
now enforce that presentation contract; canonical data remains in the event
store for replay and audit.
