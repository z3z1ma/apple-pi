---
name: ledger-execute-task
description: "Interpret and maintain the execution contract for a .ledger task. Use when asked to inspect task readiness, choose or reconcile work items, map work to acceptance criteria, resolve blockers or dependencies, or update task status and evidence from observed results. Not for implementing code or running the Ralph control loop; pi-ralph owns fresh-context execution through pi_exec."
---

# Operate a Ledger Task Contract

This skill owns the ledger semantics around execution: which records govern the task, whether it is ready, how acceptance criteria differ from work items, and how observed progress is represented. It does not implement the task or own an execution loop.

1. Use the `ledger` tool to inspect the named task, then read `task.md` and every referenced record that governs execution.
2. Check readiness without weakening the contract:
   - Scope and Non-goals bound one coherent outcome;
   - Blockers is honestly `None.`;
   - every `Depends-On` task is indexed and `done`;
   - governing specs, decisions, and plans are in valid lifecycle states;
   - assumptions that change execution are record-backed or explicitly ratified.
3. Interpret `AC-###` rows as observable outcome and invariant obligations. Interpret optional `WI-###` rows only as implementation decomposition. A completed work item does not prove an acceptance criterion or close the task.
4. Identify the smallest coherent unfinished work item or acceptance gap and state the records, source surfaces, and falsifying checks that govern it. Do not perform the implementation in this skill.
5. Update ledger records only from observed evidence:
   - Journal records material actions, discoveries, and decisions;
   - Evidence maps executed checks and their limits to acceptance criteria;
   - Blockers names anything that prevents safe progress;
   - work-item state changes only when the underlying work is complete or substantively cancelled;
   - status, Review, Retrospective, and Distillation reflect actual results rather than anticipated success.
6. Hand off a prepared execution frame: the authorized goal, `.ledger/README.md`, the task root, the smallest governing records, the next unfinished obligation, and its acceptance checks.

If readiness is incomplete, route missing evidence or semantics to the appropriate research, specification, or planning skill. If the user explicitly asks to run Ralph over the prepared task, load `pi-ralph`; that skill owns the `pi_exec` program, fresh-worker loop, workspace snapshots, and inlined pi-review acceptance. Use `ledger-distill-close-task` for closure, pause, blocking, or durable promotion.
