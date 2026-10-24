---
name: to-tickets
description: "Break a plan, specification, or current conversation into approved tracer-bullet tickets with explicit blocking edges, written to the governing ledger task by default."
disable-model-invocation: true
---

# To Tickets

Break a plan, specification, or conversation into a set of **tickets**: tracer-bullet vertical slices, each declaring the tickets that **block** it.

Use this workflow for decided work that spans several fresh contexts. If the whole change fits in one context window, skip the tickets and report that the next step is `/skill:implement`. If the input is a cleared decision map rather than one collapsed build specification, use `/skill:to-spec` first; do not ticket scattered map decisions directly.

## Process

### 1. Gather context and resolve ownership

Work from whatever is already in the conversation context. If the user passes a reference—a specification path, issue number, or URL—as an argument, fetch it and read its full body and comments. If the available capability cannot retrieve the complete source, ask the user to supply it rather than decomposing a partial body.

Honor an explicit output destination. When the source is `.ledger/<task>/spec.md`, inspect that bundle's `task.md` and confirm that its intent and current state still govern the undertaking. Otherwise inspect `.ledger/INDEX.md` and candidate live `task.md` files. One live ledger row alone does not establish ownership.

If no bundle governs the work or ownership is ambiguous, ask the operator to choose or create a task, or to name another destination; call `ledger_add` only after approval. Tickets go one file per ticket under `.ledger/<task>/tickets/`; publishing to an external tracker needs an exact target and explicit authority.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs and other governing authority in the area you are touching.

Look for opportunities to prefactor the code to make the implementation easier. **"Make the change easy, then make the easy change."**

### 3. Draft vertical slices

When the design's value is still unproven, first propose a minutes-long end-to-end demonstration of its core claim (`/skill:prototype`), and ticket the work once the demonstration shows the effect. Many tickets built on an untested premise are the costliest way to learn it fails.

Break the work into **tracer bullet** tickets.

<vertical-slice-rules>

- Each slice cuts a narrow but **COMPLETE** path through every layer needed for the behavior—schema, API, UI, tests: vertical, **NOT** a horizontal slice of one layer.
- A completed slice is demoable or verifiable on its own.
- Each slice is sized to fit in a single fresh context window.
- Any prefactoring should be done first.

</vertical-slice-rules>

Give each ticket its **blocking edges**: the other tickets that must complete before it can start. A ticket with no blockers can start immediately.

A prefactor ticket belongs first only when it genuinely gates later slices, can land green independently, and has a concrete enabling outcome. Do not turn opportunistic cleanup into a prerequisite. When preparation cannot stand alone usefully, keep it inside the first vertical slice.

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change—rename a column, retype a shared symbol—whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Do not force it into a tracer bullet; sequence it as **expand–contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius—per package, per directory—each batch its own ticket blocked by the expand, keeping CI green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in a ticket blocked by every migrate batch. When even the batches cannot stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify ticket; green is promised only there.

Describing an integration branch does not authorize creating it, committing to it, or publishing it.

Before presenting the graph, verify that every blocker names a proposed ticket, no ticket blocks itself, the graph has no cycles, blockers precede their dependents in the numbering, and at least one ticket has no blockers. Ticket numbers are identities in topological order, not global implementation priority or a requirement that independent frontier tickets run serially.

### 4. Write the drafts, check them, and get sign-off

Write the drafts into the bundle, one file per ticket under `.ledger/<task>/tickets/<NN>-<slug>.md`, numbered from `01` in dependency order with blockers first, using the template below. A ticket that cannot answer "what can I demo or verify when this is done?" is a horizontal slice and must be redrafted. Each acceptance criterion grades observable behavior the ticket owns, is false just before the ticket starts (after its blockers are done), names the observation that would show it false, and does not merely restate the request.

Before the operator sees them, give a standing `principal-engineer` (call in one who has checked your tickets before, or hire one) the bundle path and ask it to check the slicing, the blocking edges, and the acceptance criteria against the repository. Fix what it finds.

Then read and apply [`operator-sign-off`](../operator-sign-off/SKILL.md) for a ledger task (plan boundary): a cold reader, then `sign_off_task`. The verdict is the approval; apply its annotations to the ticket files. Until it is approved, the tickets are drafts and nobody implements them.

Work the **frontier**: any ticket whose blockers are all done. `Status: ready-for-agent` means a ticket is specified well enough for a fresh agent, not that it is on the frontier. Later status changes belong to the implementation workflow. Leave the parent specification or issue unchanged.

<local-ticket-template>

# <NN>: <Ticket title>

**What to build:** the end-to-end behavior this ticket makes work, from the user's perspective, not a layer-by-layer implementation list.

**Blocked by:** the numbers/titles of the tickets that gate this one, or "None (can start immediately)".

**Status:** ready-for-agent

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2

</local-ticket-template>

Avoid specific implementation file paths or code snippets: they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can—a state machine, reducer, schema, or type shape—inline it and note briefly that it came from a prototype. Trim it to the decision-rich parts, not a working demo, just the important bits.

## Regeneration after a specification pivot

When an amended specification makes tickets stale, re-read it and the repository, redraft the affected tickets in place, and take the new graph through the same check and sign-off. Before implementation starts, replace the set and recompute numbering and blockers. After it starts, keep completed tickets that still hold, ask before changing an in-progress ticket, replace unstarted ones, and record a correction to completed work as a new ticket.

## Finish

Report the ticket paths, the approved graph and its initial frontier, any prefactor or expand-contract sequence, and that the next step is `/skill:implement`. This skill writes tickets only: it implements, commits, and dispatches nothing.
