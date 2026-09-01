---
name: diagnosing-bugs
description: Diagnosis loop for hard bugs and performance regressions. Use when the user says "diagnose"/"debug this", or reports something broken/throwing/failing/slow.
---

# Diagnosing Bugs

A discipline for hard bugs. Skip phases only when explicitly justified.

When exploring the codebase, read relevant domain-language pages in `.wiki/` (if they exist) to get a clear mental model of the relevant modules, and check ADRs in the area you're touching.

## Authority and working record

Follow the request's intent. A request to diagnose or explain why something fails stops after the confirmed cause and proposed fix. A request to fix or debug it authorizes the smallest local causal change after diagnosis. Ask when that intent is materially ambiguous. Neither path authorizes commits, pull requests, deployment, publication, production instrumentation, or other external effects.

When an active ledger task governs the work, keep a compact redacted record of repro commands, minimised inputs, replay data, profiles, hypotheses, harnesses, and captured observations only when they have resume, handoff, or audit value. If that continuity requires persistence and no task governs the work, ask whether to create one or which existing task owns it before writing. Otherwise keep the exchange transient and do not create a task or evidence file solely for ceremony. Durable regression tests and their fixtures belong in the repository's normal test tree.

Default loops to local or disposable environments. Replaying state-changing requests, stressing or fuzzing shared systems, profiling production, and adding production instrumentation require explicit authorization. Protect existing work when bisection changes a worktree or checked-out revision.

## Redact

This skill has you show commands, outputs and captured artifacts. **Redact every secret first**: write `<REDACTED>` in its place. Build loops against env vars, so the credential stays in the environment rather than in what you show. Captured artifacts carry auth headers: quote only the lines that carry the signal.

Raw secret-bearing HAR files, logs, core dumps, and similar captures do not belong in the ledger. Keep them only in an explicitly approved secure or ephemeral location, and retain a redacted signal or pointer.

If the redacted output is not enough to diagnose the bug, say so and ask the user.

## Phase 1: Build a feedback loop

**This is the skill.** Everything else is mechanical. If you have a **tight** pass/fail signal for the bug (one that goes red on _this_ bug), you will find the cause; bisection, hypothesis-testing, and instrumentation all just consume it. If you don't have one, no amount of staring at code will save you.

Spend disproportionate effort here. **Be aggressive. Be creative. Refuse to give up.**

### Ways to construct one, in roughly this order

1. **Failing test** at whatever seam reaches the bug: unit, integration, e2e.
2. **Curl / HTTP script** against a running dev server.
3. **CLI invocation** with a fixture input, diffing stdout against a known-good snapshot.
4. **Headless browser script** (Playwright / Puppeteer) that drives the UI and asserts on DOM/console/network.
5. **Replay a captured trace.** Save a real network request / payload / event log to disk; replay it through the code path in isolation.
6. **Throwaway harness.** Spin up a minimal subset of the system (one service, mocked deps) that exercises the bug code path with a single function call.
7. **Property / fuzz loop.** If the bug is "sometimes wrong output", run 1000 random inputs and look for the failure mode.
8. **Bisection harness.** If the bug appeared between two known states (commit, dataset, version), automate "boot at state X, check, repeat" so you can `git bisect run` it.
9. **Differential loop.** Run the same input through old-version vs new-version (or two configs) and diff outputs.
10. **Structured HITL loop.** Last resort. If a human must click, the root defines numbered operator actions, named observation fields with redaction rules, and an explicit predicate that turns those observations into a red or green verdict. Present the protocol through ordinary conversation; use `ask_user_question` only when it is available and a response fits its bounded structured-choice contract. Incorporate every returned observation into the diagnosis. A read-only child returns the exact protocol to its parent for presentation through ordinary chat. An interactive shell helper is operator-run in a real terminal outside agent `bash`. Any script run through Pi is non-interactive and limited to setup, probing, or normalising observations already supplied. Persist a compact redacted record under an existing active ledger task only when continuity warrants it. Never capture credentials.

Build the right feedback loop, and the bug is 90% fixed.

### Tighten the loop

Treat the loop as a product. Once you have _a_ loop, **tighten** it:

- Can I make it faster? (Cache setup, skip unrelated init, narrow the test scope.)
- Can I make the signal sharper? (Assert on the specific symptom, not "didn't crash".)
- Can I make it more deterministic? (Pin time, seed RNG, isolate filesystem, freeze network.)

A 30-second flaky loop is barely better than no loop; a 2-second deterministic one is tight, a debugging superpower.

### Non-deterministic bugs

The goal is not a clean repro but a **higher reproduction rate**. Loop the trigger 100×, parallelise, add stress, narrow timing windows, inject sleeps. A 50%-flake bug is debuggable; 1% is not, so keep raising the rate until it's debuggable.

### When you genuinely cannot build a loop

Stop and say so explicitly. List what you tried. Ask the user for: (a) access to whatever environment reproduces it, (b) a redacted captured artifact (HAR file, log dump, core dump, screen recording with timestamps), or (c) permission to add temporary production instrumentation. Do **not** proceed to hypothesise without a loop.

### Completion criterion: a tight loop that goes red

Phase 1 is done when the loop is **tight** and **red-capable**: you can name **one loop**—normally a command such as a script path, test invocation, or curl; a structured HITL procedure is the sole exception—that you have **already run at least once** (show its invocation and output or its named captured observations and interpreted verdict, redacted), and that is:

- [ ] **Red-capable**: it drives the actual bug code path and asserts the **user's exact symptom**, so it can go red on this bug and green once fixed. Not "runs without erroring"; it must be able to _catch this specific bug_.
- [ ] **Deterministic**: same verdict every run (flaky bugs: a pinned, high reproduction rate, per above).
- [ ] **Fast**: seconds, not minutes.
- [ ] **Agent-runnable**: commands run unattended; the sole exception is the structured HITL procedure above.

If you catch yourself reading code to build a theory before this loop exists, **stop: jumping straight to a hypothesis is the exact failure this skill prevents.** No red-capable loop, no Phase 2.

## Phase 2: Reproduce + minimise

Run the loop. Watch it go red as the bug appears.

Confirm:

- [ ] The loop produces the failure mode the **user** described, not a different failure that happens to be nearby. Wrong bug = wrong fix.
- [ ] The failure is reproducible across multiple runs (or, for non-deterministic bugs, reproducible at a high enough rate to debug against).
- [ ] You have captured the exact symptom (error message, wrong output, slow timing) so later phases can verify the fix actually addresses it.

### Minimise

Once it's red, shrink the repro to the **smallest scenario that still goes red**. Cut inputs, callers, config, data, and steps **one at a time**, re-running the loop after each cut, and keep only what's load-bearing for the failure.

Why bother: a minimal repro shrinks the hypothesis space in Phase 3 (fewer moving parts left to suspect) and becomes the clean regression test in Phase 5.

Done when **every remaining element is load-bearing**: removing any one of them makes the loop go green.

Do not proceed until you have reproduced **and** minimised.

## Phase 3: Hypothesise

Generate **3–5 ranked hypotheses** before testing any of them. Single-hypothesis generation anchors on the first plausible idea.

Each hypothesis must be **falsifiable**: state the prediction it makes.

> Format: "If <X> is the cause, then <changing Y> will make the bug disappear / <changing Z> will make it worse."

If you cannot state the prediction, the hypothesis is a vibe: discard or sharpen it.

**Show the ranked list to the user before testing.** They often have domain knowledge that re-ranks instantly ("we just deployed a change to #3"), or know hypotheses they've already ruled out. Cheap checkpoint, big time saver. Don't block on it; proceed with your ranking if the user is AFK.

## Phase 4: Instrument

Each probe must map to a specific prediction from Phase 3. **Change one variable at a time.**

Tool preference:

1. **Debugger / REPL inspection** if the env supports it. One breakpoint beats ten logs.
2. **Targeted logs** at the boundaries that distinguish hypotheses.
3. Never "log everything and grep".

**Tag every debug log** with a unique prefix, e.g. `[DEBUG-a4f2]`. Cleanup at the end becomes a single grep. Untagged logs survive; tagged logs die.

**Perf branch.** For performance regressions, logs are usually wrong. Instead: establish a baseline measurement (timing harness, `performance.now()`, profiler, query plan), then bisect. Measure first, fix second.

## Phase 5: Fix + regression test

If the request authorizes diagnosis only, do not apply a fix. After confirming the cause, proceed to Phase 6 cleanup, then report the evidence and proposed fix while preserving the red loop; do not claim the bug is fixed. Continue the fix steps below only when the request authorizes a local fix.

Write the regression test **before the fix**, but only if there is a **correct seam** for it.

A correct seam is one where the test exercises the **real bug pattern** as it occurs at the call site. If the only available seam is too shallow (single-caller test when the bug needs multiple callers, unit test that can't replicate the chain that triggered the bug), a regression test there gives false confidence.

**If no correct seam exists, that itself is the finding.** Note it. The codebase architecture is preventing the bug from being locked down. Flag this for the next phase.

If a correct seam exists:

1. Turn the minimised repro into a failing test at that seam.
2. Watch it fail.
3. Apply the fix.
4. Watch it pass.
5. Re-run the Phase 1 feedback loop against the original (un-minimised) scenario.

## Phase 6: Cleanup

Required before returning from either a diagnosis-only or fix-authorized run:

- [ ] All `[DEBUG-...]` instrumentation added by this diagnosis removed (`grep` the exact prefixes used)
- [ ] Throwaway harnesses and working copies created by this diagnosis removed from the production tree; useful redacted diagnosis artifacts retained only in the ledger when continuity matters; pre-existing and operator-owned files left intact
- [ ] The confirmed cause is recorded in the active ledger task when one governs and in the final report; include it in commit or PR wording only when that effect is authorized

For an authorized fix, also required before declaring the bug fixed:

- [ ] Original repro no longer reproduces (re-run the Phase 1 loop)
- [ ] Regression test passes (or absence of seam is documented)

For a diagnosis-only run, retain the red loop evidence and state explicitly that the bug remains unfixed.
