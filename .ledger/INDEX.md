# Task Ledger

- `.ledger/202610030109-context-ablation-experiment/task.md` — planning — Measure a learning's value by removing it from a fresh agent's context — Proposed experiment: run a fresh agent on a known-answer task with one curated learning removed, compare effort with a full-context baseline, and use the difference to keep or prune the learning.

- `.ledger/202610030836-responsive-work-panel/task.md` — in-progress — Make the shared work panel the direct responsive control surface — Replace the centered work picker with one non-capturing Agents/Tasks panel; command aliases select tabs and narrow terminals use a top-center half-height layout.

- `.ledger/202610030909-headless-fork-reflections/task.md` — in-progress — Run passive reflections in headless forks of the conversation — Change reflection and automatic learning reflection run as headless forks of the live conversation (identical request prefix) and return one passive message, instead of continuing the run in-band.

- `.ledger/202610041515-repository-history-replay/task.md` — planning — Repository histories as replay worlds for improving the harness — Treat each completed ledger task with its transcripts, commits, and scalar measures as a stored history; accumulate them per repository and replay or re-simulate harness policies over them to make the agent work better in that repository (after Dream-RSI).

- `.ledger/202610141906-code-context-sidecars/task.md` — in-progress — Code context sidecars with read injection and block-and-retry edit gate — `<file>.context` Markdown sidecars hold invariants and hazards; top-level reads append the whole sidecar plus a hash marker, and edit/write are blocked until the current marker is in the effective context. Includes context_lint and reflection/distill upkeep.

- `.ledger/202610150034-code-context-evaluation/task.md` — planning — Evaluate code context sidecars on replayed failure tasks — Phase 5 of code-context sidecars: replay 3–5 historical failure tasks under Baseline, Read-only injection, and Full v1 (gate) and compare pre-edit constraint awareness, plan changes after blocks, violation rates, and token overhead.

- `.ledger/202610232305-handbook-org-runtime/task.md` — planning — Organization runtime for the handbook model — Runtime changes the skill handbook needs: <manager> guidance for unroled roots, working sessions reporting to the coordinator by default, and plain workplace tool renames added as skills come up.

- `.ledger/202610241552-run-bash-through-a-pty-by-default/task.md` — in-progress — Run Bash through a PTY by default — Bash stdout/stderr on PTY slaves (no controlling terminal) so programs emit terminal colors; plain text to the model, styled view in the UI, pipe fallback.

- `.ledger/202610302251-implement-semantic-review-queue-and-reviews/task.md` — in-progress — Implement semantic review queue and /reviews — Implement approved exact-target semantic/risk-based reviews with durable peer execution, replace /work with a single master-detail review queue, and wire native tools, Workplace and sign-off.

- `.ledger/202610312051-unify-git-targets-and-make-change-capture-efficient/task.md` — in-progress — Unify Git targets and make change capture efficient — Use one exact change-target model across review, explanation, sign-off and evidence helpers; share demand-driven Git plumbing and prove performance against native Git without losing fidelity.

- `.ledger/202611012305-front-desk-continuous-organization/task.md` — planning — Build the front desk: the organization as one continuous agent — Implement the approved super-agent proposal: dispatch posture, on-call coordinator, desk channel as default composer, Threads and Activity views, durable schedules, watchdog, external GitHub/CI/Jira threads, channel charters, inline/spill delivery, and drastic Chat polish.

- `.ledger/202611020841-workplace-polish-ux-loop/task.md` — in-progress — Workplace polish and UX loop: Slack-grade agent workspace — Repeated review-fix rounds over every Workplace surface against its inspiring software (Slack, Superhuman, Linear, VS Code), then a UX and robustness loop on the Chat tab and front desk: steps, attention cost, ergonomics, message actions, coordinator proactiveness.

- `.ledger/202611021348-desk-intelligence/task.md` — in-progress — Desk intelligence: a runtime activity stream the coordinator acts on, and open-ended exploration — Runtime-owned ingestion of Slack, GitHub and Jira activity into one filterable stream shown in Workplace Activity; the coordinator triages it as it arrives; a standing explorer connects threads and builds knowledge. Replaces remind_me sweeps.

- `.ledger/202611021905-task-scoped-recall/task.md` — in-progress — Task-scoped recall: message spans per task and a fast, salient session search — Record which span of each person's transcript belongs to the task they focused, let search_session scope to tasks across the people who worked them, and make recall fast (indexed, not whole-file scans) and more useful, gated on Kofi's recall evaluation.

- `.ledger/202611022254-mechanize-judgment/task.md` — planning — Mechanize judgment: lessons as lint rules, budgets, path contracts, models and replay — What apple-pi takes from poteto's 4-day game: every found issue becomes a mechanical rule, budgets enforced by the build, file-path contracts linted, TLA+ models of our state machines, deterministic replay and headless tuning loops.
