Status: done
Created: 2026-10-21
Updated: 2026-10-22

# Interns and peers replace subagents

## Intent

Subagents were a flexible delegation system: background runs, resume, steering, nesting, clarification, coding children with notebook access and completion review, custom agent definitions, and a live team view. Persistent peers in the organization now own all cross-agent work, so that machinery carries complexity, memory, and lifecycle cost for little use. The 37 finished builders held in one root process for three days are an example.

Terms: a peer is a lasting top-level Pi session in the organization ([docs/organization.md](../../docs/organization.md)); the machinery being removed is described in [docs/subagents.md](../../docs/subagents.md).

Keep only what a session needs to read without filling its own context: two interns, `explore` (the local repository and filesystem) and `research` (external sources). Each is a first-class tool whose description says when to use it and what it costs. An intern returns a lossy summary: the main window gets less context, but only what the intern chose to report.

## Decisions (operator, 2026-10-21)

1. The `agent` tool goes away, with `get_subagent_result`, `steer_subagent`, `stop_subagent`, and the `<subagent-team>` prompt. All other cross-agent work happens through peers.
2. Explorer and researcher become their own tools, not agent types. Under the hood they work as before, but they are one-shot: no background, no resume, no steering. They are not kept alive after they answer.
3. No custom agent definitions (`.pi/agents`, `.agents/agents`, `~/.pi/agent/agents`). Roles, peers, and the organization replace them.
4. `pi_exec` model workers run on peers, so everything runs through one mechanism. A `pi_exec` call can attach existing peers as an input: a mapping of program variable names to peer handles. An `agent` call on no attached peer starts an ephemeral peer that is discarded when the execution ends, and the program (and the agent) can close one sooner, so a loop does not pile up tmux windows. A call returns what the model writes in its reply (prose, or a typed value), never mail. Ralph needs nothing special: each iteration is a new ephemeral peer, closed before the next.
5. `/btw` stays and owns its one session directly, with no manager.
6. While an intern runs, a live activity line (current tool and argument) is enough. There is no conversation viewer and no transcript afterwards.
7. The same effort leans into self-organizing, hierarchical, human-like behavior: give the model one coherent set of tools that work like human communication in a digital medium and like a human organization. The workplace proposal ([proposal-workplace.md](proposal-workplace.md)) items 1 to 12 and A to E are approved; `explore` and `research` are framed as a cheap intern, with the same benefits, caveats, and risks.
8. Work is assigned, not inferred: a person holds tasks someone assigned, and work with no ledger task is an ephemeral task with the same bundle shape. Details are proposal items 13 to 24, approved; ledger tasks are shown in the headquarters, not the quest office (Jira's).
9. The two one-shot tools are called **interns**, never senses, in prompts, tools, and docs.
10. Custom agent definitions are deleted, including the operator's `~/.pi/agent/agents/grafana-debugger.md` (deleted during implementation, with his approval of 2026-10-21).
11. The pair programmer's hidden consultant is removed. For a second opinion, the pair writes to the main session's manager or escalates to a peer through the organization's own mail; the organization answers, not a hidden run.

Decision 4 details, confirmed by the operator ("lgtm"):

- An ephemeral peer is started into a catalog role, and the role sets its model; the old `type` and `profile` arguments go away.
- A discarded ephemeral peer's session record is deleted, so it does not join the former members; its transcript file stays on disk.
- A plain `agent()` call closes its ephemeral peer when it returns; a program that needs several turns holds a handle (`peer(role=...)`), which it closes or which is discarded when the execution ends.

## Open questions

None. The specification records the approved decisions.

## Current State

The operator approved the specification and all 14 tickets on 2026-10-22, then asked for solo implementation in ticket order with commits as it proceeds. Tickets 01 to 09 are implemented: threaded mail, human-named management, pull channels with mentions, the operator inbox and escalation, meetings, explicit tasks and assignments, and hiring that assigns work. Inferred ledger binding and quick-model intent are removed; the directory and views use actual assignments and focus. The two one-shot intern tools now run on their own headless runner, with live tool activity and cancellation rather than retained sessions. The pair now asks colleagues for second opinions through ordinary mail, and sees their replies in its trajectory; the hidden consultant is removed. Each ticket records its checks and deviations.

Ticket 10 is done. Its shared turn mechanism is implemented and tested: ordinary peers accept correlated program turns, wait when busy, return prose or validated structured values, and cancel only the requested run. Runtime loss also stops the owned turn without stopping unrelated work. Program-scoped process ownership is implemented too: temporary peers and nested scopes are cleaned after completion, cancellation, or daemon loss, while lasting people, shared work, and transcripts survive. Ten lifecycle tests include headless launches, transfers, pre-hello cancellation and crash recovery, and ten tmux iterations without leftover panes. The Python handles and named attachments are now wired, and the review/Ralph reference programs use catalog roles. Focused tests, typecheck, loader, formatting, lint, context lint, and packaging passed; see [implementation notes](implementation-10.md).

Ticket 11 is done. Optional Todos and Backlog were deleted by the operator's scope change. Interns and `/btw` have independent lifecycle owners. The retained child manager, public tools and UI, custom definitions, child context/notebook writes, and child-row production are gone; historical evidence remains readable. Skills and fork policies now use the surviving workplace tools. Focused suites, the offline pair harness, typecheck, loader, formatting, lint, context lint, and packaging passed; see [implementation notes](implementation-11.md). Ticket 12 is done: a hire receives team history before its first turn, retirement collects and posts the person's own handover before it commits, and the manager charter offers standups through existing tools. Cancellation, sleeping people, restart recovery, and the World retirement wait are checked; see [implementation notes](implementation-12.md). Ticket 13 is done: Agent World shows threads, meetings, escalations, task boards, team notices, notes, and focused quests, and the operator hands goals to people through the runtime; see [implementation notes](implementation-13.md). Ticket 14 is done: the docs, `AGENTS.md`, README, and wiki describe the current workplace, and the boundaries record the rejected ideas; see [implementation notes](implementation-14.md). The end-of-task full suite passed except two load timeouts that passed when rerun alone. All 14 tickets are done. Live organization rollout stays a separate step.

## Outcome

Pending.
