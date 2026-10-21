# 07: The senses only

**What to build:** The subagent team a session sees is explorer and researcher. `consultant`, `planner`, and `designer` leave the default agents; the pair programmer's hidden consultation keeps its own consultant path. `builder` stays registered and callable by name for `pi_exec` `agent_run` and the skills that use it, but is not listed in the team prompt. Skills, prompts, programs, docs, and tests that named the removed agents are updated to hire a person or to use a sense.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The `<subagent-team>` prompt section lists explorer and researcher only; `agent` with `subagent_type: builder` still runs; `consultant`, `planner`, and `designer` are rejected as unknown types.
- [x] The pair programmer's `ask_consultant` consultation still runs and returns a typed disposition in its existing tests.
- [x] `grep` over skills, prompts, docs, and `.pi/programs` finds no instruction to use the planner, designer, or public consultant.
- [x] `docs/subagents.md` and the README describe the two senses and the hidden builder.

Deviations: `docs/subagents.md` carries the senses and the hidden builder; the README catalog row names them. The code-review skill's `review-planner` is a `pi_exec` worker with its own prompt, not the removed planner type, and stays.
