# `to-tickets` fidelity study

Sources: `mattpocock/skills` at `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`

- `skills/engineering/to-tickets/SKILL.md`
- `docs/engineering/to-tickets.md`
- `skills/engineering/setup-matt-pocock-skills/issue-tracker-local.md`
- downstream `skills/engineering/implement/SKILL.md`

Status: approved; implementation and validation complete

## Role in the workflow

`to-tickets` is an explicit human-invoked decomposition step for decided work that must be completed across several fresh contexts. It accepts a specification, plan, issue, or the current conversation. If the whole change fits one context, the tickets add overhead and the work should move directly to implementation.

The output is an approved blocker graph of agent-sized execution artifacts. The skill produces the graph; it does not dispatch agents, implement work, commit, close parent work, or maintain a scheduler.

## Upstream doctrine to preserve

1. Keep `disable-model-invocation: true`.
2. Read the complete supplied source, including comments when the source is an issue. Explore the repository when current code structure, test precedent, or vocabulary is not already known.
3. Use project domain language and respect governing ADRs and repository authority.
4. Look for prefactoring that genuinely makes the change easy before making the easy change.
5. Ordinary tickets are **tracer bullets**: each is a narrow but complete path through every required layer, independently demoable or verifiable, and sized for one fresh context. A schema/API/UI/test layer by itself is not a ticket.
6. Every ticket declares only the other tickets that genuinely block it. Tickets with no incomplete blockers form the current **frontier**.
7. Present the complete numbered breakdown before writing. For every ticket show its title, blockers, and end-to-end delivery. Ask whether granularity and edges are right and whether tickets should merge or split. Iterate, then stop and wait for explicit approval.
8. Write one file or remote issue per approved ticket, never one combined ticket document. Number blockers first in topological order beginning at `01`.
9. Keep ordinary implementation file paths and code snippets out. A compact prototype-derived state machine, reducer, schema, or type shape may be included when it records a decision more precisely than prose; identify its source.
10. Leave parent specifications and issues unchanged unless separately authorized.

## Vertical slices and prefactoring

Each ordinary ticket must answer: **What can be demonstrated or independently verified when this ticket alone is done?** Its acceptance criteria must grade only behavior that the ticket owns.

Prefactoring is planned before the work it enables, but it does not justify speculative cleanup. A separate prefactor ticket is warranted only when it genuinely gates later slices, can land green independently, and has a concrete enabling outcome. Otherwise keep necessary preparation inside the first vertical slice.

## Wide-refactor exception

Preserve upstream's expand–contract sequence literally for a wide mechanical change that cannot land as independent vertical slices:

1. **Expand** — add the new form beside the old while keeping the repository green.
2. **Migrate** — move caller groups in blast-radius-sized batches, each blocked by expand and independently green while both forms coexist.
3. **Contract** — remove the old form only after every migration completes.

If migration batches cannot remain green independently, keep the sequence but describe a shared integration branch ending in an integrate-and-verify ticket. Planning that branch does not authorize creating it, committing to it, or publishing it.

## Source and destination ownership

Use a source explicitly supplied by the operator. A source may be a local specification or plan, a remote issue or URL, or the settled current conversation. Fetch and read the full source when capability and authority permit; otherwise ask the operator to supply it rather than ticketing from a partial body.

Resolve the output without an active-task pointer:

1. Honor an explicit output destination.
2. When the source is `.ledger/<task>/spec.md`, inspect its `task.md` and confirm that the live bundle still semantically governs the undertaking.
3. Otherwise inspect `.ledger/INDEX.md` and candidate live `task.md` files. One live row alone does not establish ownership.
4. If no bundle governs the work or ownership is ambiguous, include a task/destination choice in the breakdown-approval checkpoint. Use `ledger_add` only after explicit approval.

The default local layout is skill-owned rather than ledger-wide:

```text
.ledger/<task>/
  spec.md
  tickets/
    01-<slug>.md
    02-<slug>.md
```

A repository-defined external tracker does not silently redirect the output. Remote publication requires an exact target and explicit authority. Combine the target, graph approval, and publication approval in one checkpoint when possible. Use native blocker or sub-issue relationships where supported; body text is the fallback. Apply a remote `ready-for-agent` label only when the repository defines that exact label and the approved publication includes it. Keep one canonical ticket set rather than mirroring complete bodies locally and remotely.

## Graph integrity

Before writing, verify:

- every blocker reference names a proposed ticket;
- no ticket blocks itself;
- the graph has no cycle;
- blocker numbers precede dependent numbers;
- at least one initial frontier ticket exists; and
- numbering is identity/topological order, not global implementation priority.

The frontier is derived from ticket states and blocker edges. Report it after publication; do not create a second stored frontier or graph registry.

## Upstream local template

```markdown
# <NN>: <Ticket title>

**What to build:** the end-to-end behavior this ticket makes work, from the user's perspective, not a layer-by-layer implementation list.

**Blocked by:** the numbers/titles of the tickets that gate this one, or "None (can start immediately)".

**Status:** ready-for-agent

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
```

Upstream documentation records two recurring failures that the literal skill does not fully prevent:

- horizontal tickets that cannot answer what can be demonstrated when complete; and
- acceptance criteria that are already true, can only be satisfied by another ticket, or merely restate the request.

The operator chose to preserve the literal upstream template despite those documented failure modes. Do not add `Source`, `Demo or verification`, falsifier fields, or additional acceptance-criteria structure. Preserve the upstream documentation's pre-approval review discipline in prose: each criterion must grade observable behavior owned entirely by that ticket, be false at the ticket's starting point after blockers, have an observable falsifier, and not merely restate the request.

## Regeneration after a specification pivot

Current `to-spec` requires affected tickets to be regenerated after an in-place material redesign.

Before implementation starts, re-read the amended specification, present the complete replacement graph and removal plan, and replace the local generated ticket set in place after approval. Recompute numbering, blockers, frontier, and criteria; do not leave stale tickets beside the current graph.

After implementation starts, preserve completed tickets that remain valid, require an explicit operator decision before changing in-progress work, and replace only affected unstarted tickets. If completed work is invalidated by the pivot, preserve its record and represent the required correction as a new ticket. Remotely published tickets still require explicit authority before any edit, closure, replacement, or edge mutation.

## Completion report

Report:

- the canonical ticket paths or remote identifiers;
- the approved blocker graph;
- the initial frontier;
- any prefactor or expand–contract sequence; and
- whether the tickets are ready for separately invoked implementation.

Do not dispatch workers, implement, close parent work, commit, or update remote state beyond the explicitly approved publication.

## Proposed package shape

- `skills/to-tickets/SKILL.md` only; no runtime graph, scheduler, or supporting reference is presently justified.
- Human-only loader visibility.
- README, provenance, adopted-boundary, loader, and Pi Exec discovery reconciliation.
- Proportional loader/package checks rather than a prose behavior harness.

## Validation

- The real skill loader discovers `to-tickets` with no diagnostics and human-only invocation; Pi Exec skill discovery excludes it.
- The package dry run contains `skills/to-tickets/SKILL.md`.
- A separate fidelity review compared the implementation with both upstream skill and engineering documentation. It restored acceptance-criteria review, decision-map collapse through `to-spec`, agent-ready/no-triage semantics, topological-number identity, and criteria regeneration without changing the approved literal ticket template.
- Validation passed the 80-test focused runtime suite, the 916-test unit suite, typecheck, loader validation, formatting, focused lint, package inclusion, and scoped diff checks.
- No tracker bridge, stored graph, scheduler, runtime mechanism, or prose behavior harness was added.

## Resolved operator decisions

1. **Ticket template** — preserve upstream literally: title, `What to build`, `Blocked by`, `Status`, and a plain acceptance checklist. Do not add hardening fields.
2. **Initial status** — keep local `Status: ready-for-agent`. It means the ticket is sufficiently specified for a fresh agent, not that it is currently on the frontier. Later state transitions belong to the `implement` design.
3. **Regeneration after work starts** — preserve valid completed tickets, ask before changing in-progress work, replace affected unstarted tickets, and represent invalidated completed work with corrective tickets.
