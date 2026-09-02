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

If no bundle governs the work or ownership is ambiguous, include a destination choice when presenting the ticket breakdown. Ask the user to select or create a task, supply another destination, or stop. Call `ledger_add` only after explicit approval, and never invent a detached ticket location.

The default local destination is one file per ticket under `.ledger/<task>/tickets/`. A repository-defined external tracker does not silently redirect the output. Remote publication requires an exact target and explicit authority.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs and other governing authority in the area you are touching.

Look for opportunities to prefactor the code to make the implementation easier. **"Make the change easy, then make the easy change."**

### 3. Draft vertical slices

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

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets, if any, must complete first
- **What it delivers**: the end-to-end behavior this ticket makes work

Ask the user:

- Does the granularity feel right? Too coarse or too fine?
- Are the blocking edges correct: does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?

A ticket that cannot answer "What can I demo or independently verify when this is done?" is a horizontal slice and must be redrafted.

Before approval, review every acceptance criterion. It must grade observable behavior owned entirely by that ticket, be false immediately before the ticket starts after its blockers are done, name an observation that would show it false, and not merely restate the request. Keep the local template literal; these are review checks rather than additional fields.

Iterate until the user approves the complete graph, then **stop and wait for explicit approval** before writing or publishing any ticket. When the destination or remote publication authority also needs confirmation, combine those choices into this checkpoint.

### 5. Publish the approved tickets

Publish one ticket per file or remote issue. The tickets are the same either way; only the representation of blocking edges changes.

- **Local files** → write one file per ticket under `.ledger/<task>/tickets/<NN>-<slug>.md`, numbered from `01` in dependency order with blockers first. Each file's `Blocked by` field lists the numbers and titles it depends on. Use the local template below: one ticket per file, never a single combined ticket document.
- **A remote issue tracker** → publish one issue per ticket in dependency order with blockers first so each ticket's blocking edges can reference real identifiers. Use the platform's native blocking or sub-issue relationship where it has one; otherwise put the blocking issues in the body. Apply a `ready-for-agent` label only when the repository defines that exact label and the approved publication includes it.

Keep one canonical ticket set rather than mirroring full ticket bodies locally and remotely.

Work the **frontier**: any ticket whose blockers are all done. For a purely linear chain that means top to bottom. `Status: ready-for-agent` means a local ticket is sufficiently specified for a fresh agent; it does not mean the ticket is currently on the frontier. These tickets are agent-ready by construction and do not need a separate triage workflow. Later status transitions belong to the implementation workflow.

Do **not** close or modify any parent specification or issue.

<local-ticket-template>

# <NN>: <Ticket title>

**What to build:** the end-to-end behavior this ticket makes work, from the user's perspective, not a layer-by-layer implementation list.

**Blocked by:** the numbers/titles of the tickets that gate this one, or "None (can start immediately)".

**Status:** ready-for-agent

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2

</local-ticket-template>

<issue-template>

## Parent

A reference to the parent issue on the tracker. Omit this section when the source was not an existing issue.

## What to build

The end-to-end behavior this ticket makes work, from the user's perspective, not layer-by-layer implementation.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by

- A reference to each blocking ticket, or "None (can start immediately)".

</issue-template>

In either form, avoid specific implementation file paths or code snippets: they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can—a state machine, reducer, schema, or type shape—inline it and note briefly that it came from a prototype. Trim it to the decision-rich parts, not a working demo, just the important bits.

## Regeneration after a specification pivot

When an amended specification makes existing tickets stale, re-read the complete specification and current repository state, then present the complete replacement or removal plan through the same approval checkpoint.

Before implementation starts, replace the generated local ticket set in place after approval. Remove stale files and recompute numbering, blockers, acceptance criteria, and the frontier so the task bundle presents one coherent current graph.

After implementation starts:

- preserve completed tickets that remain valid;
- ask the user before changing any in-progress ticket;
- replace affected unstarted tickets and update their blocking edges; and
- preserve an invalidated completed ticket as execution history and represent the required correction with a new ticket.

Any remotely published ticket edit, closure, replacement, or blocker mutation requires explicit authority.

## Finish

Report:

- the canonical ticket paths or remote identifiers;
- the approved blocker graph;
- the initial frontier;
- any prefactor or expand–contract sequence; and
- whether the tickets are ready for separately invoked `/skill:implement`.

This skill produces the artifact. Do not dispatch agents, implement tickets, commit work, close parent work, or create an integration branch.
