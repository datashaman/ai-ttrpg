# AI TTRPG Engine

This context describes the shared language for an AI-assisted tabletop role-playing experience in which game truth remains distinct from interpretation and narration.

## Language

**Solo Play**:
A play mode with one human **Player** and no human **Game Master**. The system facilitates the world while preserving explicit authority boundaries between rules, uncertain answers, and narration.
_Avoid_: AI GM, single-player mode

**Structured Play**:
A Solo Play input mode in which the Player chooses authored actions, Oracle questions, targets, and other available options without language-model interpretation. It resolves through the same game rules and may present outcomes as mechanical summaries.
_Avoid_: fallback parser, debug mode, menu mode

**Player**:
The human participant who declares what their character attempts and asks questions about the game world.
_Avoid_: User

**Player Character**:
The person within the game world whose actions the Player declares. In the first Adventure, the Player Character has a fixed structure and inventory while the Player chooses their name, pronouns, motivation, and one-time assignment of Trait ratings.
_Avoid_: Player, avatar, hero

**Non-Player Character**:
A person within the game world who is not controlled by the Player. In the Micro-ruleset, a Non-Player Character does not make an opposed roll against the Player Character.
_Avoid_: NPC, bot, agent

**Trait**:
A broad capability of a Player Character that modifies a Check. During setup, the Player assigns +0, +1, and +2 once among Might, Wits, and Presence; ratings do not change during the first Adventure.
_Avoid_: attribute, stat, skill

**Motivation**:
The Player-chosen reason the Player Character enters and persists in the Adventure. It guides interpretation and narration but never changes a Check, Oracle answer, resource, or outcome stake.
_Avoid_: objective, quest, mechanical drive

**Free Action**:
An action whose outcome is not meaningfully uncertain or whose failure would not materially change the situation. A Free Action proceeds without a Check.
_Avoid_: automatic success, trivial action

**Check Proposal**:
The Narrator's explicit recommendation to resolve a Player Character's intended goal with a Check, identifying the relevant Trait and the stakes for a Setback, Success with Cost, and Clean Success. The Player may confirm it, correct the interpreted goal or Trait, revise the attempted action, or withdraw; changing the action requires a new validated proposal rather than direct negotiation of its stakes.
_Avoid_: roll request, difficulty check

**Check**:
The resolution of a confirmed Check Proposal with 2d6 plus the relevant Trait, producing a Setback, Success with Cost, or Clean Success.
_Avoid_: Oracle question, skill check, test

**Pending Choice**:
A Player decision required before an in-progress resolution can continue, such as whether to spend Resolve after a Check roll is revealed. Resuming play restores the same Pending Choice and recorded roll.
_Avoid_: unsaved state, interrupted turn

**Contested Action**:
A Player Character action resisted by a Non-Player Character, resolved as a single Player-facing Check. The opposition shapes the stakes rather than making a separate roll.
_Avoid_: opposed check, opposed roll, contest

**Confrontation**:
A Scene in which the Player Character works to overcome active opposition through Contested Actions. It ends when either its Resistance Clock or Danger Clock is filled.
_Avoid_: combat, battle, encounter

**Defeat**:
The adverse end of a Confrontation caused by a filled Danger Clock or depleted Health. Defeat leads to a predeclared consequence such as capture, forced retreat, incapacitation, or a lasting Condition; it does not mean Player Character death in the first Adventure.
_Avoid_: death, game over, Setback

**Mechanical Effect**:
A ruleset-defined change to game state, such as losing Health, spending Resolve, consuming an item, gaining a Condition, or advancing a Clock. The Narrator may describe a Mechanical Effect but cannot invent one.
_Avoid_: consequence, narration

**Fictional Consequence**:
A newly Established Fact caused by an outcome that changes the situation without implicitly changing a numeric or rules-governed capability.
_Avoid_: Mechanical Effect, flavour text

**Condition**:
A named, rules-governed circumstance that temporarily changes what an affected character can do or how rules apply to them.
_Avoid_: status effect, tag

**Shaken**:
A Condition that prevents the Player from spending Resolve for the affected Player Character. It clears when the current Scene ends.
_Avoid_: frightened, stunned, disadvantage

**Restrained**:
A Condition that prevents the Player Character from taking actions that require free movement. It persists across Scene transitions until an Established Fact or successful action explicitly removes it.
_Avoid_: immobilized, grappled, disadvantage

**Clock**:
A visible measure of progress toward a consequential change in the situation.
_Avoid_: timer, counter, tracker

**Resistance Clock**:
The Clock measuring progress toward defeating, driving off, subduing, or otherwise overcoming opposition in a Confrontation.
_Avoid_: enemy Health, victory meter

**Danger Clock**:
The Clock measuring escalating pressure toward the predeclared adverse end of a Confrontation.
_Avoid_: enemy turn, threat meter

**Health**:
The Player Character's three-point capacity to withstand physical harm. Ordinary harm removes one Health, and reaching zero causes Defeat.
_Avoid_: hit points, HP

**Resolve**:
The Player Character's three-point capacity to change a Check after seeing its roll but before its outcome is established. The Player may spend one Resolve per Check to add +1 to its final total; reaching zero does not itself cause Defeat.
_Avoid_: sanity, mana, willpower

**Field Kit**:
A single-use item carried by the Player Character that restores one Health or one Resolve outside a Confrontation. It is the only way to recover either resource during the first Adventure.
_Avoid_: healing potion, rest, medkit

**Inventory Item**:
A distinct object carried by the Player Character that may permit an approach or become an explicit outcome stake without granting an automatic numeric bonus. An Inventory Item is either carried or removed; consumption, loss, surrender, or breakage removes it rather than creating a damaged state. The first inventory contains a Lantern, Lockpick Set, Short Blade, and Field Kit.
_Avoid_: equipment bonus, gear score

**Game Master**:
A human facilitator who adjudicates and presents the game world. A **Solo Play** session has no Game Master.
_Avoid_: AI GM, narrator

**Oracle**:
The authority that answers an Unresolved Proposition with Yes or No when no human **Game Master** is present. Its answer is distinct from a Check, which determines whether a character succeeds.
_Avoid_: AI GM, narrator

**Likelihood**:
The Player-visible odds confirmed by the Player before the Oracle answers an Unresolved Proposition: Unlikely means 25% Yes, Even means 50% Yes, and Likely means 75% Yes. The Narrator may recommend a Likelihood from Established Facts but cannot select it finally.
_Avoid_: difficulty, target number

**Exceptional Consequence**:
An additional favourable or adverse turn attached to an Oracle answer by an extreme percentile result. It enriches the answer but does not replace or reverse its Yes or No truth value.
_Avoid_: critical success, critical failure

**Narrator**:
The presenter of established game facts and outcomes. A Narrator does not determine whether an uncertain proposition is true.
_Avoid_: Game Master, Oracle

**Unresolved Proposition**:
A question about the game world that has no answer yet. It becomes an Established Fact only when play makes the answer relevant and the Oracle resolves it.
_Avoid_: secret, hidden fact, unknown fact

**Established Fact**:
A canonical, non-probabilistic proposition about the game world whose truth has been determined. Provenance may describe the reliability of a source or report, but it never weakens or overrides an Established Fact.
_Avoid_: lore, canon, hidden fact

**World Knowledge Entry**:
A stable, attributable projection item representing either an Established Fact or a World Knowledge Relationship, carrying its Provenance, Visibility, and Knowledge Scope without becoming a separate source of game truth.
_Avoid_: lore record, model memory, knowledge-base fact

**World Knowledge Relationship**:
A stable, typed connection between two Established Fact entry IDs, carrying its own Provenance, Visibility, and Knowledge Scope while remaining a projection of canonical game truth. A relationship is attributable knowledge about how established subjects connect; it is not a separate Established Fact or source of truth. Its canonical Reveal also reveals its endpoint entries so the relationship never exceeds their Visibility.
_Avoid_: inferred link, model association, knowledge-graph truth

**Provenance**:
The attributable origin of a World Knowledge Entry, identifying how its Established Fact or World Knowledge Relationship entered canonical game truth and the stable source that supports that origin.
_Avoid_: citation text, confidence, generated explanation

**Visibility**:
The explicit boundary that determines which application actor scopes may observe a World Knowledge Entry. Visibility is distinct from whether the Established Fact is true and from who knows it within the fiction.
_Avoid_: permission, secrecy convention, prompt filter

**Knowledge Scope**:
The in-world boundary describing who knows an Established Fact or World Knowledge Relationship. It may change through a Reveal without changing the represented truth or original Provenance.
_Avoid_: access control, audience, confidence

**Reveal**:
A canonical change that expands the Knowledge Scope of an existing World Knowledge Entry while preserving the represented Established Fact or World Knowledge Relationship and its original Provenance. Revealing a relationship also reveals its endpoint entries so their Visibility remains equal. Displaying, narrating, or citing hidden knowledge is not a Reveal.
_Avoid_: disclosure, narration, new fact

**Evidence Bundle**:
An immutable, task-specific collection of Player-visible source items supplied to a model, each identified by its source and inclusion reason. An Evidence Bundle may include Established Facts, rules, entities, and accepted events, but is not itself game truth and cannot authorize a state change.
_Avoid_: prompt context, model memory, truth

**Model Call Record**:
An operational audit record of one model task, including its provider, model, prompt version, Evidence Bundle references and hashes, timing, usage, validation, retries, fallback result, and validated output. A Model Call Record may correlate with accepted commands and events, but raw provider payloads are diagnostic data rather than default record content; the record is not part of a Timeline and cannot rebuild game state.
_Avoid_: canonical event, Adventure history, model memory

**Model Task**:
One stateless request for interpretation, rules explanation, or narration, containing explicit task input and one Evidence Bundle. A Model Task has no provider-managed conversational memory and cannot directly establish game truth.
_Avoid_: chat session, agent turn, conversation memory

**Micro-ruleset**:
The original, intentionally small ruleset used to prove the first playable experience. It resolves uncertain actions with 2d6 plus a relevant trait and distinguishes a Setback, Success with Cost, and Clean Success.
_Avoid_: demo rules, test rules, house rules

**Adventure**:
A bounded playable situation made up of one or more possible Scenes and brought to a conclusion through the Player's choices. Scenes may be skipped, and an Adventure may end favourably, adversely, or unresolved. The first Adventure is a three-Scene mystery set in a locked manor.
_Avoid_: campaign, story, module

**Timeline**:
One continuous history of accepted events within an Adventure. Rewinding creates a new Timeline from a chosen event position while preserving the original Timeline unchanged and inheriting its random-stream position.
_Avoid_: save, undo, overwritten history

**Scene**:
A bounded span of play with a particular situation, place, active participants, and pre-authored exit conditions. A Scene ends when a committed event satisfies an exit condition; that condition may lead to another Scene or an Adventure ending, and the Narrator only presents the transition. The first Adventure offers arrival and exploration, social discovery, and confrontation Scenes without requiring all three.
_Avoid_: level, chapter, encounter

**Setback**:
The outcome of a check totaling 6 or less, in which the attempted goal is not achieved and the situation changes adversely.
_Avoid_: failure, miss

**Success with Cost**:
The outcome of a check totaling 7–9, in which the attempted goal is achieved with a meaningful complication, sacrifice, or reduced effect.
_Avoid_: partial success, mixed success

**Clean Success**:
The outcome of a check totaling 10 or more, in which the attempted goal is achieved without an additional adverse consequence.
_Avoid_: critical success, full success

## Example dialogue

> **Developer:** In Solo Play, does the Narrator decide whether the guard works for the cult?
>
> **Domain expert:** No. The Oracle answers that uncertain question. The Narrator presents the answer once it has become an established game fact.
>
> **Developer:** The language model is unavailable. Is the Adventure paused?
>
> **Domain expert:** No. The Player continues through Structured Play, and the same rules establish outcomes without generated narration.
>
> **Developer:** Is the witness secretly a cult member before the Player investigates?
>
> **Domain expert:** No—the witness's allegiance is an Unresolved Proposition. It becomes an Established Fact when play requires the Oracle to answer it.
>
> **Developer:** The Evidence Bundle includes a rule and an Established Fact. Can the model commit the rule's effect or treat the bundle as new game truth?
>
> **Domain expert:** No. The Evidence Bundle only attributes the sources available for one model task. Established Facts and accepted events remain authoritative, and application code still validates and commits any resulting command.
>
> **Developer:** Should the model's full request and response be appended to the Timeline for auditing?
>
> **Domain expert:** No. Store them in a Model Call Record correlated with any resulting command and events. The Timeline remains the replayable history of accepted game truth.
>
> **Developer:** Can the provider remember earlier turns so the Narrator stays consistent?
>
> **Domain expert:** No. Each Model Task receives the relevant Evidence Bundle explicitly. Continuity comes from accepted events and projected game state, not hidden provider memory.
>
> **Developer:** Does auditing require every raw provider prompt and response to be saved?
>
> **Domain expert:** No. A Model Call Record keeps attributable metadata and validated output. Raw payload capture is an explicit, local diagnostic choice and is never part of an Adventure export.
>
> **Developer:** The Player is highly persuasive, so is the witness being a cult member Likely?
>
> **Domain expert:** Persuasiveness affects a Check, not Likelihood. Likelihood reflects evidence about what is already plausible in the world.
>
> **Developer:** The Narrator recommends Likely based on the fresh tracks. Can the Oracle roll immediately?
>
> **Domain expert:** No. The Player must confirm or change the Likelihood before the Oracle answers.
>
> **Developer:** The Player takes physical harm. Do I reduce the Player's Health?
>
> **Domain expert:** Reduce the Player Character's Health. The Player is the human participant; the Player Character exists in the game world.
>
> **Developer:** Should opening an unlocked drawer trigger a Wits Check?
>
> **Domain expert:** Not by itself. It is a Free Action unless uncertainty and a meaningful adverse outcome make a Check Proposal necessary.
>
> **Developer:** Can the Narrator decide that an 8 also injures the Player Character after the roll?
>
> **Domain expert:** No. Every outcome's stakes are part of the Check Proposal confirmed before the roll.
>
> **Developer:** Can the Narrator say that being noticed makes the Player Character easier to hit?
>
> **Domain expert:** Only through a ruleset-defined Mechanical Effect such as a Condition. Otherwise, being noticed is a Fictional Consequence and cannot carry a hidden modifier.
>
> **Developer:** The Player accepts the risky approach but wants to remove the alarm Clock from its Setback. Can they edit that stake?
>
> **Domain expert:** No. They can revise or withdraw the action and receive a new Check Proposal, but they cannot keep the same approach while directly softening its stakes.
>
> **Developer:** Does the cultist roll against the Player Character's attempt to sneak past?
>
> **Domain expert:** No. That is a Contested Action resolved by one Player-facing Check; the cultist's opposition is represented in the predeclared stakes.
>
> **Developer:** When does the cultist take a turn in the Confrontation?
>
> **Domain expert:** There are no separate Non-Player Character turns. Costs and Setbacks advance the Danger Clock or apply other predeclared effects; successes advance the Resistance Clock.
>
> **Developer:** The Danger Clock filled. Is the Player Character dead?
>
> **Domain expert:** No. They suffer the Confrontation's predeclared Defeat and enter a consequence Scene; death is outside the first Adventure.
>
> **Developer:** A total of 9 gives Success with Cost. Can the Player spend two Resolve to make it 11?
>
> **Domain expert:** No. They may spend at most one Resolve per Check, raising the total to 10 and selecting the already-declared Clean Success stakes.
>
> **Developer:** The session closed after that 9 was revealed but before the Player chose whether to spend Resolve. Do we reroll on resume?
>
> **Domain expert:** No. Restore the recorded roll and its Pending Choice exactly.
>
> **Developer:** The Player Character has no Resolve left. Are they Defeated?
>
> **Domain expert:** No. Health reaching zero causes Defeat; zero Resolve only removes the option to improve a Check that way.
>
> **Developer:** Does the Player Character recover after the discovery Scene?
>
> **Domain expert:** Not passively. The Player may consume the Field Kit outside a Confrontation to restore one Health or one Resolve.
>
> **Developer:** Does carrying the Short Blade add +1 to a Might Check?
>
> **Domain expert:** No. It permits an armed approach, but Inventory Items do not provide automatic numeric modifiers.
>
> **Developer:** The Lockpick Set broke. Should its condition become Damaged?
>
> **Domain expert:** No. Remove it from the inventory; v1 does not track item durability or repair.
>
> **Developer:** Can the Player move +2 from Wits to Presence before the confrontation Scene?
>
> **Domain expert:** No. The Player assigns the three ratings during setup, and they do not change after the Adventure begins.
>
> **Developer:** The Player Character's Motivation is to rescue their sister. Does that add +1 when confronting the cultist?
>
> **Domain expert:** No. Motivation explains the action and shapes narration, but it has no mechanical effect.
>
> **Developer:** Does being Shaken subtract from Presence Checks?
>
> **Domain expert:** No. It has one explicit effect: the Player cannot spend Resolve while the Player Character is Shaken.
>
> **Developer:** Do both Conditions clear when the Player Character leaves the room?
>
> **Domain expert:** No. Shaken clears when the Scene ends; Restrained persists until the Player Character is explicitly released or escapes.
>
> **Developer:** Can the Narrator end the discovery Scene when it feels dramatically complete?
>
> **Domain expert:** No. A committed event must satisfy one of the Scene's pre-authored exit conditions.
>
> **Developer:** The Player found the cellar entrance outside. Must they still question the witness?
>
> **Domain expert:** No. The established route may satisfy an exit condition leading directly to the Confrontation, or another choice may end the Adventure without one.
>
> **Developer:** The Player rewound to an earlier decision. Should we remove everything that happened afterward?
>
> **Domain expert:** No. Create a new Timeline from that event position and preserve the original Timeline for inspection or continuation.
>
> **Developer:** If the Player repeats the same action on the new Timeline, do they get a fresh roll?
>
> **Domain expert:** No. The new Timeline inherits the same random-stream position, so identical play reproduces the same result.
>
> **Developer:** The Player rolled an 8. Is that a partial success?
>
> **Domain expert:** Call it a Success with Cost: the goal is achieved, but the situation demands a meaningful cost.
>
> **Developer:** Does entering the manor begin a new Adventure?
>
> **Domain expert:** No. The locked-manor mystery is the Adventure; entering the manor moves the Player from its arrival Scene into its discovery Scene.
