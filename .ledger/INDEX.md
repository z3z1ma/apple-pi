# Task Ledger

- `.ledger/202610030109-context-ablation-experiment/task.md` — planning — Measure a learning's value by removing it from a fresh agent's context — Proposed experiment: run a fresh agent on a known-answer task with one curated learning removed, compare effort with a full-context baseline, and use the difference to keep or prune the learning.

- `.ledger/202610030836-responsive-work-panel/task.md` — in-progress — Make the shared work panel the direct responsive control surface — Replace the centered work picker with one non-capturing Agents/Tasks panel; command aliases select tabs and narrow terminals use a top-center half-height layout.

- `.ledger/202610030909-headless-fork-reflections/task.md` — in-progress — Run passive reflections in headless forks of the conversation — Change reflection and automatic learning reflection run as headless forks of the live conversation (identical request prefix) and return one passive message, instead of continuing the run in-band.

- `.ledger/202610041515-repository-history-replay/task.md` — planning — Repository histories as replay worlds for improving the harness — Treat each completed ledger task with its transcripts, commits, and scalar measures as a stored history; accumulate them per repository and replay or re-simulate harness policies over them to make the agent work better in that repository (after Dream-RSI).

- `.ledger/202610141906-code-context-sidecars/task.md` — in-progress — Code context sidecars with read injection and block-and-retry edit gate — `<file>.context` Markdown sidecars hold invariants and hazards; top-level reads append the whole sidecar plus a hash marker, and edit/write are blocked until the current marker is in the effective context. Includes context_lint and reflection/distill upkeep.

- `.ledger/202610150034-code-context-evaluation/task.md` — planning — Evaluate code context sidecars on replayed failure tasks — Phase 5 of code-context sidecars: replay 3–5 historical failure tasks under Baseline, Read-only injection, and Full v1 (gate) and compare pre-edit constraint awareness, plan changes after blocks, violation rates, and token overhead.

- `.ledger/202610232305-handbook-org-runtime/task.md` — planning — Organization runtime for the handbook model — Runtime changes the skill handbook needs: <manager> guidance for unroled roots, working sessions reporting to the coordinator by default, and plain workplace tool renames added as skills come up.

- `.ledger/202610241552-run-bash-through-a-pty-by-default/task.md` — in-progress — Run Bash through a PTY by default — Bash stdout/stderr on PTY slaves (no controlling terminal) so programs emit terminal colors; plain text to the model, styled view in the UI, pipe fallback.

- `.ledger/202610301415-first-class-organizational-process-skills/task.md` — ready — First-class organizational process skills — Plan an agent-selectable portfolio of business processes over existing people, tasks and communication, with clear authority, outcomes and live evaluation.
