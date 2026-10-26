# 07: Impacts, defects, and review findings

Part of the approved spec [../spec.md](../spec.md); its Terms table defines obligation, completion, window, horizon, scenario, impact, and the other words used here.

**What to build:** Losses and gains enter fitness only as recorded impacts. Any link's data can carry an `impact`: dollars, `incurred` or `estimated`, and an optional time. The history adapter produces an incurred impact as an economic event at its time (or the link's creation); estimated impacts are listed, never charged; every impact is listed with who recorded it. An impact records what happened, never an avoided loss (that belongs in a scenario), and must not repeat value or cost already counted; the tool description and docs say so, and the substrate does not verify impacts. `fixes` (my task fixes a defect in earlier work) and `supersedes` change nothing by themselves; a defect costs whatever impact someone records. Review findings are evidence, not value: a reviewer records a `finds` link on a task, its owner resolves it `accepted` or `rejected`, and the `fitness` result lists impacts with their links and accepted and rejected findings per task and per person; findings never change the realized number.

**Blocked by:** 02 (Record and resolve links between work), 05 (Compute counted by membership over time).

**Status:** ready-for-agent

- [ ] Against a temporary state database, a `fixes` link with data `{"impact": {"dollars": -120, "kind": "incurred"}}` lowers fitness by $120 in the window holding its time, and windows still add up.
- [ ] The same link with `"kind": "estimated"` is listed with its impact and leaves the total unchanged.
- [ ] A `fixes` link and a `supersedes` link without impacts leave the total unchanged; a fix task with its own value earns it as usual.
- [ ] Two findings on a task, one accepted and one rejected, are listed per task and per person with their resolution, and the total is the same as without them.
