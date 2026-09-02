# `wayfinder` fidelity study

Sources: `mattpocock/skills` at `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`

- `skills/engineering/wayfinder/SKILL.md`
- `docs/engineering/wayfinder.md`
- tracker operations in `setup-matt-pocock-skills/issue-tracker-local.md` and `issue-tracker-github.md`
- related docs for `grill-with-docs`, `to-spec`, `research`, `prototype`, and `ask-matt`
- Apple Pi ledger, wiki, `interrogate-to-design`, `to-spec`, `to-tickets`, `research`, and `prototype` contracts

Status: design decisions resolved; implementation awaiting approval

## Role in the workflow

`wayfinder` is a human-only multi-session planning on-ramp, not the default idea → ship front door. Use it when the destination can be named but the route is still foggy, and the effort is larger than one agent session can hold. Single-session planning stays with `/interrogate` or `/skill:interrogate-to-design`.

It charts a **shared map** of **decision tickets**: questions whose resolution is a decision, not a slice of a build to execute. The map is done when nothing remains to decide before someone builds. When the map clears, hand off to `to-spec`. Do not loop the map into `implement`.

It differs from:

- `interrogate-to-design`, which settles one design tree in one conversation;
- `to-spec`, which synthesizes already-decided work into a buildable specification;
- `to-tickets`, which cuts a specification into tracer-bullet implementation tickets; and
- `implement`, which builds settled work.

## Upstream doctrine to preserve

1. Keep `disable-model-invocation: true`.
2. **Plan, don't do.** Produce decisions, not deliverables. `task` tickets exist only to unblock a later decision, never to deliver a piece of the destination.
3. Name the **destination** first. It fixes scope for every later ticket.
4. The map is an **index, not a store**. A decision lives in exactly one place: its ticket. The map gists and links; it does not restate the answer.
5. Refer to maps and tickets by **name**, never by a bare id, number, or slug. The id may ride inside the name.
6. Keep the map body: Destination, Notes, Decisions so far, Not yet specified, Out of scope.
7. Keep ticket bodies as one `## Question`. The answer is recorded on resolution, not in the original question.
8. Keep the four types and HITL/AFK split:
   - `grilling` — HITL default; settle by talking.
   - `prototype` — HITL; talking cannot settle look or behavior.
   - `research` — AFK; a fact outside the working directory blocks a decision.
   - `task` — HITL or AFK; manual work unblocks a decision.
9. A HITL ticket resolves only through live exchange. The agent never answers the human's side.
10. **Fog or ticket** is sharpness now, not answerability now. Ticket a sharp blocked question. Leave unsharp in-scope work in **Not yet specified**. Do not pre-slice fog.
11. **Out of scope** never graduates. Close a mis-scoped ticket and record why; it does not enter Decisions so far.
12. Two modes: **chart the map** and **work through the map**. Charting never hand-resolves tickets. Working resolves **one ticket per session**, except research.
13. Charting: name the destination; grill breadth-first; stop if there is no fog; create the map; create now-sharp tickets; wire blocking in a second pass; fire research; stop.
14. Working: load the map at low resolution; take the named ticket or the first frontier ticket; **claim before any work**; zoom related tickets on demand; record the answer; close; append a one-line gist to Decisions so far; graduate now-sharp fog; rule newly past-destination tickets out of scope; update or delete invalidated tickets.
15. The **frontier** is open, unblocked, unclaimed children. A ticket is unblocked when every blocker is closed.
16. If the first breadth-first grill finds no fog, do not create a map. Ask how to proceed.
17. Hand a cleared map to `to-spec`. Go straight to `implement` only when the effort turned out genuinely small.

## Storage mapping

Upstream stores the map on the repo issue tracker (`wayfinder:map` plus child issues), with GitHub/GitLab/local-markdown operations behind `setup-matt-pocock-skills`. Apple Pi has no setup skill, no tracker registry, and no required issue tracker. Project `AGENTS.md` may name a tracker, but a documented convention alone does not publish.

Recommended default, matching `to-spec` and `to-tickets`:

1. An explicit operator destination wins.
2. Otherwise write into a semantically governing live ledger bundle. One live `.ledger/INDEX.md` row is not ownership.
3. If ownership is missing or ambiguous, ask. Use `ledger_add` only after explicit approval.
4. External tracker publication needs explicit approval even when project instructions mention GitHub, Jira, or another tracker.

Recommended local shape, owned by this skill rather than by the ledger:

```text
.ledger/<task>/map.md
.ledger/<task>/decisions/<NN>-<slug>.md
```

Keep decision tickets off `tickets/`. That path already belongs to implementation tickets from `to-tickets`. Number from `01`. Record `Type:` (`research` / `prototype` / `grilling` / `task`) and `Status:` (`open` / `claimed` / `resolved` / `out-of-scope`). Record blockers as `Blocked by: NN, NN`. Claim by setting `Status: claimed` before work. Resolve by appending `## Answer`, setting `Status: resolved`, and adding one gist-plus-link line to the map's Decisions so far.

The map body stays the upstream Markdown sections. Open tickets are not listed on the map; they are the child files.

Do not use `.scratch/`. Do not add a wayfinder catalog, graph registry, or scheduler.

## Skill composition

Pi has no model-callable Skill tool. Direct the agent to use installed skills at the named points, as `improve-codebase-architecture` already does:

- destination and grilling tickets → `interrogate-to-design` plus `domain-modeling`;
- prototype tickets → `prototype`;
- research tickets → `research`;
- Notes-named skills as written.

Keep the architecture-specific and wayfinder-specific frames in this skill. Do not duplicate those skills' complete procedures.

Omit upstream `handoff`. Invoking `/skill:wayfinder` is the bridge into a map; `to-spec` is the bridge out.

## Research and Git

Upstream charting fires research subagents onto throwaway `research/<name>` branches. That branch is only a parking place for notes, not a spike. Research tickets gather facts; prototype tickets raise fidelity with a cheap artifact. Apple Pi Researchers are read-only, so a branch has no writer. The operator chose the installed `research` skill: fire Researcher teammates, persist one Markdown file in the governing ledger bundle, and link it from the ticket. Do not create throwaway Git branches. Research remains the only parallel exception to one-ticket-per-session.

## Authority

Explicit `/skill:wayfinder` invocation authorizes charting or working the map files in the resolved destination. It does not authorize production-code changes, implementation tickets, commits, pushes, PRs, deployment, or external tracker mutation.

Keep **plan, don't do** as the default. Follow upstream: an effort may override this in its **Notes** and carry execution into the map. Warn that the agent writes those Notes and has used them as a self-licence; do not add a hard stop beyond upstream. `task` tickets still unblock decisions rather than deliver the destination.

Wiki and ADR mutations remain those of the composed skills: reusable `.wiki/` synthesis and qualified ADRs only after approval.

## Completion

Charting stops after the map, now-sharp tickets, blocking edges, and fired research exist.

A working session stops after one claimed ticket is resolved, the map gist is updated, and any newly sharp or invalidated tickets are adjusted.

When no open in-scope tickets remain and the fog is empty, report that the way is clear and the next step is `to-spec` against this map. Do not synthesize the spec inside wayfinder.

## Fidelity classification

### Preserved upstream

- Human-only multi-session planning on-ramp.
- Destination, fog, frontier, index-not-store, refer-by-name.
- Four ticket types and HITL/AFK.
- Chart versus work, one ticket per session except research.
- Claim-before-work, create-then-wire, graduate fog, out-of-scope close.
- `to-spec` handoff rather than implementation.

### Platform mappings

- Tracker issue/map/child operations map to skill-owned ledger files, or to an explicit operator destination.
- Claim-by-assignee maps to `Status: claimed`.
- `wayfinder:<type>` labels map to a `Type:` line.
- Skill-tool calls map to installed `interrogate-to-design`, `domain-modeling`, `prototype`, and `research`.
- `CONTEXT.md` maps to `.wiki/` as supporting context.

### Platform storage choices

- Decision tickets live under `decisions/`, not implementation `tickets/` or `.scratch/`.
- Research uses the installed research skill and ledger artifacts, not throwaway Git branches.
- Map Notes may still carry execution, matching upstream.

### Deliberate omissions

- No `setup-matt-pocock-skills`, tracker registry, or required GitHub/GitLab adapter.
- No `handoff` skill.
- No scheduler, graph database, or automatic implementation-ticket creation.

## Proposed package shape

- `skills/wayfinder/SKILL.md`
- Human-only loader visibility.
- README, provenance, adopted-boundary, loader, Pi Exec hidden-skill, and package inclusion reconciliation.
- Proportional loader/package checks; no prose behavior harness or runtime implementation.

## Resolved operator decisions

1. **Map storage** — ledger-first. Write `map.md` plus `decisions/<NN>-<slug>.md` in a semantically governing live ledger bundle. An explicit destination still wins. External tracker publication needs approval. One live index row is not ownership. `ledger_add` needs approval.
2. **Research persistence** — use the installed `research` skill. Persist findings in the governing ledger bundle and link them from the ticket. No throwaway Git branches.
3. **Execution override** — follow upstream. Plan, don't do is the default. Map Notes may carry execution into the map. Warn about the documented self-licence failure; do not add a hard stop beyond upstream.
