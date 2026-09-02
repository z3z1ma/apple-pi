---
name: wayfinder
description: "Plan a huge chunk of work, more than one agent session can hold, as a shared map of decision tickets, and resolve them one at a time until the way to the destination is clear."
disable-model-invocation: true
---

# Wayfinder

A loose idea has arrived, too big for one agent session, and wrapped in fog: the way from here to the **destination** isn't visible yet. Wayfinding is about finding that way, not charging at the destination. This skill charts the way as a **shared map**, then works its **decision tickets** (questions whose resolution is a decision, not slices of a build to execute) one at a time until the route is clear.

The destination varies per effort, and naming it is the first act of charting: it shapes every ticket. It might be a spec to hand off and iterate on, a decision to lock before planning starts, or a change made in place like a data-structure migration. The map is domain-agnostic: engineering work, course content, whatever fits the shape.

Single-session planning stays with `/interrogate` or `/skill:interrogate-to-design`. When the map clears, hand off to `/skill:to-spec`. Do not loop the map into `/skill:implement` unless the effort turned out genuinely small.

## Plan, don't do

Wayfinder is **planning** by default: each ticket resolves a decision, and the map is done when the way is clear, with nothing left to decide before someone goes and does the thing. The pull to just do the work is usually the signal you've reached the edge of the map and it's time to hand off. An effort may carry execution into the map only when the user explicitly approves that scope; absent that approval, produce decisions, not deliverables.

The agent may write **Notes**, but Notes are context, not authority. They may record a user-approved execution scope, but they cannot create one. When existing Notes say the map carries execution, verify that current conversation or source-addressed prior user approval supports them; otherwise stop and ask. Treat any `task` that looks like a slice of the destination as mis-typed.

This invocation authorizes charting and working the map files, ticket-linked research and prototype artifacts inside the resolved ledger bundle, and bounded wiki curation while decisions settle. ADRs still need explicit approval. Temporary production-tree prototype wiring, production implementation, implementation tickets, commits, pushes, PRs, deployment, external tracker mutation, and other external effects require separate user authority regardless of Notes.

## Refer by name

Every map and ticket has a **name**: its title. In everything the human reads (narration, the map's Decisions-so-far), refer to it by that name, never by a bare id, number, or slug. A wall of `01, 02, 03` is illegible; names read at a glance. The path and number don't vanish; a name wraps its link, but they ride _inside_ the name, never stand in for it.

## Resolve the destination

Use a destination explicitly supplied by the user. Otherwise inspect `.ledger/INDEX.md` and the candidate live `task.md` files. Write the map only in a bundle whose intent and current state clearly govern this undertaking; one live ledger row alone does not establish ownership. If no bundle governs the work or ownership is ambiguous, ask the user to select or create a task, supply another destination, or stop. Call `ledger_add` only after explicit approval, and never invent a detached map path.

A documented issue-tracker convention does not silently redirect the artifact. An external destination requires explicit authority.

The local shape, owned by this skill:

```text
.ledger/<task>/map.md
.ledger/<task>/decisions/<NN>-<slug>.md
```

Keep decision tickets off `tickets/`. That path belongs to implementation tickets from `to-tickets`. Number from `01`. Do not use `.scratch/`. Do not add a wayfinder catalog, graph registry, or scheduler.

Read relevant domain-language and design pages in `.wiki/` when they exist. Use `wiki_references` when nearby context matters. Repository documentation, tests, ADRs, and maintainer instructions remain authoritative.

## The Map

The map is a single `map.md` in the resolved destination, the canonical artifact. Its tickets are child files under `decisions/`.

The map is an **index**, not a store. It lists the decisions made and points at the tickets that hold their detail; a decision lives in exactly one place, its ticket, so the map never restates it, only gists it and links.

### The map body

The whole map at low resolution, loaded once per session. Unresolved tickets (`open` or `claimed`) are **not** listed: they are child files found by scanning `decisions/`.

```markdown
## Destination

<what reaching the end of this map looks like: the spec, decision, or change this effort is finding its way to. One or two lines; every session orients to it before choosing a ticket.>

## Notes

<domain; skills every session should consult; standing preferences for this effort; any user-approved execution scope with a source pointer>

## Decisions so far

<!-- the index: one line per closed ticket, enough to judge relevance, then zoom the link for the detail the ticket holds -->

- [<closed ticket title>](decisions/NN-slug.md): <one-line gist of the answer>

## Not yet specified

<!-- see "Fog of war": in-scope fog you can't ticket yet; graduates as the frontier advances -->

## Out of scope

<!-- see "Out of scope": work ruled beyond the destination; closed, never graduates -->
```

### Tickets

Each ticket is one file at `decisions/<NN>-<slug>.md`. The number is identity, not priority. Its body is the question, sized to one agent session:

```markdown
Type: grilling
Status: open
Blocked by:

## Question

<the decision or investigation this ticket resolves>
```

`Type:` is one of `research`, `prototype`, `grilling`, `task` (see [Ticket Types](#ticket-types)). `Status:` is `open`, `claimed`, `resolved`, or `out-of-scope`. `Blocked by:` lists blocker numbers such as `01, 02`, or is empty.

A session **claims** a ticket by setting `Status: claimed` **first**, before any work. This file claim is advisory, not an atomic lock. Only one session may select a frontier ticket automatically at a time. For parallel work, the user or coordinating root assigns distinct named tickets before the sessions start; each session verifies its ticket is still open and unblocked before claiming it. A claiming session may return an untouched ticket to `open` on a clean abort; never steal or clear another session's claim without operator confirmation.

Blocking uses the `Blocked by:` line. A ticket is **unblocked** when every listed blocker file is `resolved` or `out-of-scope`; the **frontier** is the open, unblocked, unclaimed children, the edge of the known. Scan `decisions/` for that set; first by number wins.

The answer isn't part of the original body; it's recorded on resolution (see [Work through the map](#work-through-the-map)). Assets created while resolving a ticket are linked from the ticket, not pasted in.

## Ticket Types

Every ticket is either **HITL** (human in the loop, worked _with_ a human who speaks for themselves) or **AFK**, driven by the agent alone. A HITL ticket only resolves through that live exchange; the agent never stands in for the human's side of it (a grilling session that answers its own questions has broken this).

- **Research** (AFK): Reading documentation, third-party APIs, or local resources like knowledge bases to surface a fact a decision waits on. Read and follow the installed [`research`](../research/SKILL.md) skill. Persist findings as Markdown in the governing ledger bundle and link that file from the ticket. Do not create throwaway Git branches. Use when knowledge outside the current working directory is required.
- **Prototype** (HITL): Raise the fidelity of the discussion by making a cheap, rough, concrete artifact to react to (an outline, a rough take, a stub, or UI/logic code) by reading and following the installed [`prototype`](../prototype/SKILL.md) skill. Link the prototype as an asset. Use when "how should it look" or "how should it behave" is the key question.
- **Grilling** (HITL): Conversation. The default case. Read and follow the installed [`interrogate-to-design`](../interrogate-to-design/SKILL.md) and [`domain-modeling`](../domain-modeling/SKILL.md) skills. This explicit human invocation supplies the bounded map and knowledge-curation authority; the referenced procedures supply the method.
- **Task** (HITL or AFK): Manual work that must happen before a _decision_ can be made: nothing to decide, prototype, or research, but the discussion is blocked until it's done. Signing up for a service so its API can be judged, provisioning access, moving data so its shape can be seen. This is the one type that _does_ rather than decides, and it earns its place by unblocking a decision, not by delivering the destination. The agent drives it alone where it can (AFK); otherwise it hands the human a precise checklist (HITL). External, destructive, or privileged work still needs explicit user authority. Resolved when the work is done; the answer records what was done and any resulting non-secret facts (credentials location, new URLs, row counts) later tickets depend on.

## Fog of war

The map is _deliberately_ incomplete: don't chart what you can't yet see. Beyond the live tickets lies the **fog of war**: the dim view of decisions and investigations you can tell are coming but can't yet pin down, because they hang on questions still open. Resolving a ticket clears the fog ahead of it, graduating whatever's now specifiable into fresh tickets, one at a time, until the way to the destination is clear and no tickets remain.

The map's **Not yet specified** section is where that dim view is written down: the suspected question, the area to revisit later. It's the undiscovered frontier _toward_ the destination: everything here is in scope, just not sharp enough to ticket. Write as loosely or as fully as the view allows; it doubles as a signpost for collaborators reading where the effort is headed.

**Fog or ticket?** The test is whether you can state the question precisely now, _not_ whether you can answer it now.

- **Ticket when** the question is already sharp, even if it's blocked and you can't act on it yet.
- **Not yet specified when** you can't yet phrase it that sharply. Don't pre-slice the fog into ticket-sized pieces: it's coarser than a ticket, and one patch may graduate into several tickets, or none, once the frontier reaches it.

**Not yet specified** excludes what's already decided (Decisions so far), what's already a live ticket, and what's out of scope (the next section).

## Out of scope

Fog only ever gathers _toward_ the destination. The destination fixes the scope, so work beyond it is **out of scope**: it isn't fog, and it doesn't belong in **Not yet specified**. It gets its own **Out of scope** section on the map: work you've consciously ruled out of _this_ effort. Scope, not sharpness, lands it here.

Out-of-scope work never graduates (the frontier stops at the destination), so it returns only if the destination is redrawn, and then as a fresh effort, not a resumption.

Ruling something out of scope is a scoping act, not a step on the route. When a ticket that already exists turns out to sit past the destination (mis-scoped in while charting, or exposed by a resolution), set `Status: out-of-scope` (a closed ticket is unambiguously off the frontier) and leave one line in the **Out of scope** section: the gist plus why it's out of scope, linking the closed ticket. It stays out of **Decisions so far**, which records the route actually walked; a scope boundary isn't a step on it.

## Invocation

Two modes. Either way, **never resolve more than one ticket per session**, with the exception of research tickets.

### Chart the map

User invokes with a loose idea.

1. **Name the destination.** Read and follow the installed [`interrogate-to-design`](../interrogate-to-design/SKILL.md) and [`domain-modeling`](../domain-modeling/SKILL.md) skills to pin down what this map is finding its way to: the spec, decision, or change. The destination fixes the scope, so it's settled first.
2. **Map the frontier.** Continue the design-tree interview **breadth-first** this time: fan out across the whole space rather than deep on any one thread, surfacing the open decisions and the first steps takeable now. **If this surfaces no fog** (the way to the destination is already clear, the whole journey small enough for one session), you don't need a map. Stop and ask the user how they'd like to proceed.
3. **Create the map** at the resolved destination: Destination and Notes filled in, Decisions-so-far empty, the fog sketched into **Not yet specified**.
4. **Create the tickets you can specify now** as `decisions/<NN>-<slug>.md` files, then wire `Blocked by:` edges in a **second pass** (files need numbers before they can reference each other). Wiring sorts them into the frontier and the blocked; everything you can't yet specify stays in the fog: the **Not yet specified** section.
5. **Fire the research.** For each `research` ticket you just created, read and follow the installed [`research`](../research/SKILL.md) skill to resolve it in parallel. Persist findings as Markdown in the governing ledger bundle and link that file from the ticket. Complete the same answer, status, and map-gist resolution steps for each research ticket. Do not create throwaway Git branches.
6. Stop: charting is one session's work; it hand-resolves nothing except those research tickets.

### Work through the map

User invokes with a map (path or governing task). A ticket is **optional**: without one, you pick the next decision, not the user.

1. Load the **map**: the low-res view, not every ticket body.
2. Choose the ticket. If the user named one, use it. Otherwise proceed only when no other session is selecting automatically, then take the first frontier ticket in order. **Claim it**: verify it is still open and unblocked, then set `Status: claimed` before any work.
3. Resolve it. **Zoom as needed**: fetch the full body of any related or closed ticket on demand; use whichever model-visible installed skills the `## Notes` block names. For the default conversation, read and follow [`interrogate-to-design`](../interrogate-to-design/SKILL.md) and [`domain-modeling`](../domain-modeling/SKILL.md).
4. Record the resolution: append the answer under `## Answer`, set `Status: resolved`, and **append a context pointer** to the map's Decisions-so-far.
5. Add newly-surfaced tickets (create-then-wire); graduate any fog the answer has made specifiable, clearing each graduated patch from **Not yet specified** so it lives only as its new ticket. If the answer reveals that a ticket (this one or another) sits beyond the destination, **rule it out of scope** rather than resolving it on the route. If the decision invalidates other parts of the map, update or delete those tickets.

The user may run explicitly assigned, distinct unblocked tickets in parallel, so expect other sessions to edit the same bundle. File claims make ownership visible but cannot prevent simultaneous claim races; never let parallel sessions independently choose the first frontier ticket.

## Finish

Charting stops after the map, now-sharp tickets, blocking edges, and fired research exist.

A working session stops after one claimed ticket is resolved, the map gist is updated, and any newly sharp or invalidated tickets are adjusted.

When no unresolved in-scope tickets (`open` or `claimed`) remain and **Not yet specified** is empty, report that the way is clear and the next step is `/skill:to-spec` against this map. Do not synthesize the spec inside wayfinder.
