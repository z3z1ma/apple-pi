# Optional scenarios and recorded predictions

Completed approval record: the operator approved 22/22 scoped diff hunks, and d0a0f6dc committed the twelve checked files after final independent validation.

## Decision approved

The operator approved committing ticket 14: optional scenario comparison in `org_fitness`, the read-only `predictions` tool, and supporting tests/docs. No further approval of this increment is pending. This approval did not cover an optimizer, mandatory forecasting, a new identity/binding store or live rollout.

## One calculator, different inputs

A scenario supplies opportunities (existing or anticipated work), their asserted values and hourly delay rates, initial work histories and probability-weighted outcomes. Its horizon is the duration being forecast. The adapter converts these into the same economic events used by realized fitness and calls the existing evaluator. Starting state and outcome probabilities are manager premises, not a certified live snapshot or learned base rates.

Compared scenarios must share decision point, horizon, opportunity/task identities, valuations and starting histories. Organization descriptions and outcomes may differ. Every outcome retains every initial obligation; an opportunity not initially open may remain unpursued. Endpoint inclusion belongs to the existing evaluator, not another credit rule. Assignment/wait states are not modeled and their breakdown is not reported as zero.

Example: both plans have a $300 opportunity and finish it after 1 hour within an 8-hour horizon, with no delay cost. Without a reviewer, compute is $10; a defect costs $300 with probability 0.3. Expected fitness is `0.7 * 290 + 0.3 * (-10) = $200`. With a reviewer, compute is $16 and defect probability 0.1; `0.9 * 284 + 0.1 * (-16) = $254`. The asserted model favors the latter by $54; the harness does not select or carry out that plan.

## Recording is not previewing

A preview binds all `decisionAt: recording` scenarios to one captured now. A recorded prediction stores the supplied JSON unchanged under `link.data.scenario`, on a `predicts` link from a message to the target organization. Its recording clock is immutable link creation. The preview is not claimed to occur at the later recording instant. Hypothetical impacts stay inside the scenario, not top-level incurred impact data.

A caller is the person invoking the tool. Predictions list only links whose recorded target is that caller's current organization root and which pass the historical ownership check at recording, using the stored originating anchor or surviving legacy evidence. A later merge does not import former-root forecasts or substitute a larger observation root. Mature observations use the recorded target over `[recordedAt, recordedAt+horizonMs)`. A fixed absolute clock differing from recording is not silently shifted. A positive horizon must actually advance the bound epoch instant at machine precision; it is not silently scored as an empty window.

| Case | What is shown | Numerical forecast error |
|---|---|---|
| Horizon not finished | Expected, end time and applicable qualification | None; no future realized evaluation |
| Mature, verified unchanged basis | Expected and observed measured totals with coverage/source limits | Observed minus expected |
| Fixed clock mismatch | Expected and mature observed totals, clock reason | Withheld |
| Changed numeric value or delay rate | Expected and mature observed totals, drift reason | Withheld |
| Anticipated, missing, not-yet-created at recording, unvalued, foreign or otherwise unverifiable task basis | Expected and mature observed totals, unverifiable reason | Withheld |
| Observed fitness includes unvalued work | Expected and observed partial total, coverage/incomplete flag | Withheld |
| A derived observation/error cannot be represented finitely | Available finite figures and an explicit reason | Withheld, not Infinity or ambiguous JSON null |
| Unreadable scenario shape/source | Link reference, raw data and reason | None; other readable rows remain available |

Valuation admission precedes goal-file reads. Genuine errors in relevant owned files remain errors. Generic links store valid JSON; isolation of unreadable scenario payloads is not SQLite corruption recovery. Forecast error is calibration of a supplied model against recorded measurement, not proof that a reorganization caused a gain. Static historical source exclusions remain explicit, not a claim of complete accounting. Task existence/opening at recording is checked separately from structural ownership. Unrepresentable coverage shares are explicitly unavailable, not fabricated ratios; this does not alter the evaluator.

## Settled verification and limits

Lucette, the independent review chair, ran the final twelve-file snapshot: 110/110 tests across scenarios/fitness/work/coordinator/cost-history with `--maxWorkers=2`, plus the loader, Node/web typecheck, Biome checks on 7 files and context lint on 159 files. Hashes were unchanged across checks, including the late strengthened opening-time positive control. Agnieszka, the implementation manager, verified those hashes and byte equality to the scoped review-only worktree before committing d0a0f6dc. The review worktree was then removed. This is checked scoped-byte evidence, not an isolated whole-commit test environment.

Waylon independently reproduced and rechecked incomplete observed valuation, later-created task identity and clock collapse, and tested actual accepted-command raw/time recovery. Lucette independently reproduced/rechecked error overflow and numeric observation/coverage qualifications. All four board findings were addressed. The earlier manager source-kind, opaque-ID ordering and unmodeled-state findings retain manager attribution. Morag's author runs of 102 tests, 110 tests before the late test edit, and a renewed 62 tests cover separate earlier snapshots; they are not substituted for the chair's final 110-test run.

Agnieszka's package dry-run includes the new module and existing dependencies. Maeve's cold read found no framing blocker and verified the example arithmetic. Direct/faux-session checks do not prove `pi_exec` composition: the separate generated-stub precheck failure is still reported, not repaired by this ticket. No full suite, installed-tarball or live rollout is claimed. Supplied premises, timestamp ties, legacy/history loss and source measurement exclusions remain explicit.

## Next step

The reviewed increment is committed. Proceed with the assigned [ticket 15 peer-accounting repair](tickets/15-keep-history-on-peer-disposal.md), then [ticket 16: `/org`](tickets/16-org-command.md) and [ticket 17: manager guidance and demonstration](tickets/17-teach-evidence-informed-adaptation.md). Live migration/runtime validation is a separate rollout step.
