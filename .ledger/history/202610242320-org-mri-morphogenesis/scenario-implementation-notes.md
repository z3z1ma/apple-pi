# Accepted ticket 14 implementation notes

Purpose: implement [ticket 14](tickets/14-scenarios-and-predictions.md) without a second calculator or prediction store. `U` below means the existing pure `evaluate` function over economic events. A forecast supplies assumptions and hypothetical histories; the harness scores those inputs, not their plausibility.

Waylon's source-derived plan was accepted in t-3693ff68; the operator's clock/valuation choices are recorded in the linked ticket. These notes are an implementation handoff, not delivered code or executed test evidence. Next: build the adapter and native tools, run the listed acceptance checks, then obtain review and approval.

## Minimal representation

Store unchanged scenario under link.data.scenario. This prevents hypothetical impacts from becoming top-level incurred link.data.impact assertions.

Scenario fields:
- name:string
- decisionAt: epoch milliseconds or the literal string `"recording"`
- horizonMs: positive finite number
- organization:string, descriptive assumed people/roles
- opportunities:[{id:string, taskId?:string, value:number, costOfDelayPerHour:number}]
- start:[{opportunity:string, openedMs:number, closedMs?:number, status?:done|cancelled}]
- outcomes:[{probability:number, tasks:[same task-history shape], compute:[{atMs:number,dollars:number}], impacts:[{atMs:number,dollars:number}]}]
- evidence?:string[]

`id` identifies an opportunity within the scenario; optional `taskId` identifies an existing runtime task for later valuation comparison. An anticipated opportunity has no such current task binding. `start` records obligations already present at the decision point; each outcome's `tasks` describes its complete hypothetical history, not just changes to that starting list.

History times are offsets in milliseconds relative to decisionAt. Start rows open at/before0 and any close is at/before0. Outcomes contain one complete history for each initial obligation, preserving its opening and already-closed state; they may pursue any subset of other opportunities opening at/after0. Close/status are paired, close>=open, IDs are unique and declared. Initial obligations cannot disappear to avoid delay or be reopened/reclosed to duplicate value. Compute is nonnegative, impacts signed, all numbers finite, probabilities in[0,1], nonempty outcomes summing1 with only machine-roundoff allowance, no automatic renormalization or arbitrary caps.

## One evaluator

Emit existing EconomicEvent values on done closure, delay on obligation intervals, compute and incurred impacts; evaluate(events,0,horizonMs). Preserve U's endpoint semantics: a close at0 is in the window; a negative close is out; a close after horizon is clipped. Initial history appears once. Do not add a separate credit rule. Sum probability*U. Scenario adapter may leave delay state unspecified rather than inventing assignments/waits.

For example, a starting task opened one hour before the decision point and finishes one hour after it. With value $300, delay rate $5/hour and $10 compute in the forecast window, `U` is $285: only the one post-decision hour of delay is charged in that window, not both hours. Here one hour is 3,600,000 milliseconds.

Compare canonical maps, not array order. Require equal resolved decision point, horizon, opportunity IDs/task identities, numeric valuations and starting histories. Name differing dimensions. Organization text, outcomes and evidence may differ. Supplied starting state is a manager premise, not a certified live snapshot. Test the reviewer example200 vs254 and full-history echo using U, plus initial carryover, closed/cancelled work, unpursued opportunities, probability errors and every comparison mismatch.

## Clock and calibration

There are three distinct concepts:

| Term | Meaning |
| --- | --- |
| Preview origin | One captured current time shared by scenarios compared in that call |
| Recording time (`t`) | Immutable creation time of the stored prediction link |
| Horizon (`H`) | Duration from the origin; the recorded observation window is `[t, t + H)` |

Relative `"recording"` scenarios bind once to a captured now in one preview comparison, and to immutable link.created_at for recorded predictions. Raw data is never rewritten with an exact runtime timestamp. Preview is not claimed to be the later recording's instant. Fixed absolute origins mismatching recording time remain unscored as clock mismatch, not silently shifted.

Predictions are pending until t+H, then observe realizedFitness for [t,t+H) against the recorded target organization identity, not a larger current-root substitution. Listing in this organization-level tool requires recorded to_id===callerRoot plus historical-origin admission; former-root/subtree forecasts are not silently imported after a merge. Mature fixed-clock mismatches retain expected/observed figures over the recording window but no numerical error, explicitly stating the mismatch. Forecast error is calibration, not causal effect. Keep expected and observed totals visible when available. Known valuation drift suppresses error as valuation changed. Anticipated/unmapped/missing/unvalued current opportunity valuations suppress error as valuation unverifiable. Here valuation comparison means checking current recorded numeric inputs, not verifying their economic truth. No guessed title/path binding or new identity store. Check all opportunities, not just pursued outcomes, and compare both value and cost of delay. Archive/move preserves task identity; estimate authorship/formatting alone is not numeric drift.

Read rows independently; unreadable scenario data remains visible with raw data/reason. Existing generic links preserve data exactly and accepted-command replay preserves ID/time. Test raw roundtrip/replay, malformed isolation, pending/mature boundary and both numeric valuation edits.

## Integration seams and limitations

New cohesive scenario/prediction adapter imports evaluate/realizedFitness/readValuation. Keep evaluate unchanged. org_fitness accepts scenarios instead of realized-window arguments; predictions is every-person read-only. Register and activate, update coordinator and loader expectations, faux nonmanager calls and docs/contexts.

Use one ROOT Type.Object schema with optional mode fields and explicit runtime exactly-one-mode checks. guest-api.ts toolSignature reads root properties; a root Type.Union would produce a zero-argument composition signature. Nested scenario schemas are supported. Do not add a duplicate tool or engine workaround.

Separately, the manager's pi_exec fails before execution even for reset=true/code1 with a generated-stub invalid-type-form error. This is reported to the operator, not fixed by this ticket. Direct native/faux-session proof must not be presented as proof of pi_exec composition.

Focused tests only with maxWorkers2, no full-suite or live rollout claim. Existing historical accounting limits stay explicit until ticket15.
