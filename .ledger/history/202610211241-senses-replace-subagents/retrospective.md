Status: done
Created: 2026-10-21
Updated: 2026-10-22

# Retrospective

## What Mattered

The harness now has one way for agents to work together: lasting people in an organization who talk through threads and hold assigned tasks. The subagent system, its retained processes, its custom definitions, and its child rows are gone. Two cheap interns cover one-shot reading. `pi_exec` runs catalog-role peers. The pair asks colleagues for second opinions by mail. Agent World shows the same workplace: meetings, boards, assignments, and focused quests. All 14 tickets were done in order with focused checks and one full suite at the end.

The largest risks were lifecycle ownership (peer turns, cancellation, and cleanup after daemon loss) and removal without breaking hidden consumers. Both were handled by tests at the real seams: a spawned runtime, faux sessions, headless processes, and headless Chrome.

## Learnings

- Structured options initially narrowed the question too far: the operator wanted to replace the delegation model, not simplify its existing controls. Record an answer outside the offered choices as a design decision in `task.md`, keep the task in planning, and confirm the proposed interface with a small code sketch and explicit open details before implementation. That let the peer handles, ephemeral lifetime, and reply-based results settle without prematurely building the wrong lifecycle.

- Trace the process and session owner before diagnosing retained agents. At scoping, `pi_exec` workers already ran as one-shot headless processes with discovery disabled and an explicit extension list, while interactive `agent` calls ran in-process sessions retained by `AgentManager` for results and resume. A finished public child shared its parent's pid and could legitimately remain alive until the parent session ended; it was not necessarily a stale runtime row. These were the two lifetimes being replaced, not the intended workplace contract. Keeping them distinct directed cleanup at the retained manager and reuse at the one-shot runner.

- Inventory opt-in consumers before removing a shared service. The first search omitted `optional-extensions`, so deleting the managed-subagent service broke Todos' real `startBackground` dependency. Typechecking caught it. Separate the unused consultant path from the still-used background path, then move the consumer before removing its owner; package inclusion, not default activation, determines the search boundary.

- Inspect the full region when deleting tests by title boundaries. Removing obsolete pair tests also removed `loadPairExtension`, a shared helper between test blocks. Five offline harness failures exposed the mistake; restoring the helper returned the harness to 112 passing checks. Preserve intervening helpers and run the surrounding harness, not only the new tests.

- Probe the interpreter's object lifetime before binding host resources. Monty's `ClassInstance` store retains wrappers for the whole interpreter session, longer than one `pi_exec` invocation. The dump/load probe showed that a plain Python class containing only an id can call the current feed's host functions instead. Keep resources in the invocation owner and checkpoint only ids; use ordinary external helper names because leading-underscore stub names were not imported. [Implementation notes](implementation-10.md#monty-handles) record the peer binding.

- Keep cancellation out of the work queue it must unblock. A real peer API test with one concurrency slot timed out because the running turn held the slot needed by its own `close()`. Closing now bypasses the work semaphore while still consuming call budget; cleanup is awaited before the final trace and usage snapshot. Test this at the one-slot boundary, not only with spare capacity. The invariant lives with `host-calls.ts`, and the red/green evidence is in the [implementation notes](implementation-10.md#third-slice-public-integration).

- Register Pi event handlers with literal event names. A loop over a union of valid names failed with TS2769 because `ExtensionAPI.on` exposes literal-name overloads rather than a generic event map. Separate registrations preserve each handler's inferred event type.

- During a tool-surface migration, compare names with the approved spec and current registrations before trusting the running session's injected catalog. This long-lived session still exposed `schedule` after source and package-loader checks had moved to `remind_me`; treating the live declaration as current almost reversed that migration. Loaded capabilities and the checkout can legitimately describe different versions until reload.

- Search spelling variants and distinguish execution surfaces when removing APIs. The guidance inventory missed `sub-agents` in the design-it-twice procedure, while a blanket ban on bare `agent` also rejected a valid reference to the retained Python function. The regression test in `tests/workplace-guidance.test.ts` checks hyphenated variants and removed native-tool wording while allowing `pi_exec`'s peer functions. Inspect both false negatives and false positives before widening a textual guard.

- Run the whole browser step before you call a World change done. Focused runs skipped a quest-office test whose loose place-name pattern the new meeting room matched, and two stale movement tests had failed since an earlier commit. A full `test:world` run and a baseline worktree at the earlier commit separated the new break from the old ones.

- Split a documentation sweep by file ownership and give each lane the same banned-term search. Three parallel lanes rewrote about 45 files without conflict, and each lane reported the code-vs-spec differences it found. The lead still had to sweep files that no lane owned.

## Improvements

- Live rollout of the organization onto the new tools remains a separate step for the operator.
- A former member at the inn no longer offers the give action; no test covers it yet.
- A wing banner opens the headquarters' team channel, which is not the wing manager's channel in a nested team.
