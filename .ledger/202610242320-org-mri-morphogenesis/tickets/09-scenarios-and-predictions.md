# 09: Scenarios and recorded predictions

Part of the approved spec [../spec.md](../spec.md); its Terms table defines obligation, completion, window, horizon, scenario, impact, and the other words used here.

**What to build:** Expected fitness uses the same evaluator as realized fitness through a scenario adapter. A scenario names its horizon, the organization it assumes (as text), its opportunities (the external work available: existing and anticipated tasks with their valuations), and outcomes; each outcome is a probability and a hypothetical history over those opportunities (which tasks are pursued, their open and close times and status, compute, and impacts). Probabilities must sum to 1. Given scenarios instead of a window, `fitness` returns each one's expected fitness (the probability-weighted sum of U over its outcomes) and the U of each outcome, and compares scenarios only when they share the same decision point, starting work state (obligations open and closed at that time), opportunities, valuations, and horizon. Forecast error measures calibration, not the causal effect of a mutation. A manager records a scenario as a prediction with a `predicts` link from the message that states the mutation to the organization; its creation time is when it was recorded. The read-only `predictions` tool, installed for every person, lists recorded scenarios: pending until `t+H` has passed, then their expected fitness beside the realized fitness over `[t, t+H)` and the forecast error (realized minus expected). A prediction whose valuations differ from the current ones is marked "valuation changed" with no error; one whose data is not a readable scenario is listed as unreadable with its raw data.

**Blocked by:** 02 (Record and resolve links between work), 05 (Compute counted by membership over time), 07 (Impacts, defects, and review findings).

**Status:** ready-for-agent

- [ ] A scenario that reproduces an observed history (same tasks, opens, closes, compute, and impacts) evaluates to exactly that history's realized fitness.
- [ ] A $300 change with no cost of delay: without a reviewer, 70% clean ($10 compute, U = $290) and 30% a defect with an incurred impact of -$300 (U = -$10) gives $200; with a reviewer costing $6, 90% clean (U = $284) and 10% defect (U = -$16) gives $254: the reviewer adds $54 of expected fitness.
- [ ] A scenario whose probabilities sum to 0.9 is refused; two scenarios whose decision points, starting work states, opportunities, valuations, or horizons differ are refused for comparison with the difference named.
- [ ] A scenario recorded through `link` keeps its data exactly; `predictions` lists it as pending until its horizon passes, then shows realized minus expected for a known history.
- [ ] After an edit of one task's value, and separately of its cost of delay, the prediction shows "valuation changed" and no error; a `predicts` link with data that is not a scenario is listed as unreadable with its raw data.
- [ ] Through a faux session a person without manager tools calls `fitness` with two scenarios and calls `predictions`; the package-load smoke test lists `predictions`.
