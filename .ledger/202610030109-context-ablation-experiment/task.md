Status: planning
Created: 2026-10-03
Updated: 2026-10-03

# Measure a learning's value by removing it from a fresh agent's context

## Intent

Find out how much one piece of curated knowledge helps an agent. A learning that changes nothing costs context on every session; a learning whose absence makes an agent fail is worth keeping or moving to a more prominent home.

The idea came from studying `github.com/llopresto87/Cypress`, whose `validate-knowledge` skill tests a knowledge base with clean-context agents and known-answer questions. This experiment adds a deliberate gap and a comparison against a full-context baseline.

When the operator would run it is not decided. Candidate triggers:

- pruning always-loaded text such as `AGENTS.md`, injected prompt sections, or skill bodies;
- deciding whether `/distill` should keep a proposed lesson;
- checking a skill or wiki page after a large edit.

## Sketch

1. Distill learnings L1…Ln for a task whose correct answer is known.
2. Baseline: run a fresh agent with all learnings.
3. Ablation: for each Li, run a fresh agent with the same context minus Li.
4. Compare effort to a correct finish, and record whether the agent found the missing knowledge, failed, or finished wrongly with confidence.
5. Classify each learning: load-bearing, rediscovered cheaply, or unused.

## Known limits

- `pi_exec` `agent_run` returns `toolCalls` and token `usage`, but no turn count (`extensions/runtime-implementation.ts`, `agent.run` result). The interactive `agent` path counts turns in its activity state but does not return the count to a program. Comparing turns needs a small addition to the `agent_run` result.
- Agent effort varies between runs. One run per condition is not evidence; the number of repeats needs a measurement before it is chosen.
- Each comparison costs several model runs.

## Open questions

- Which trigger justifies building this first?
- Is the right home a saved `.pi/programs/` program or a skill reference?
- Which effort signal decides: tool calls, tokens, or turns?

## Current State

Planning. No implementation. Typed `agent_run` workers (needed by any program here) were fixed on 2026-10-03 to default to worker-supported tools.

Next step: the operator picks the first trigger; then answer the remaining open questions and write acceptance criteria before moving to `ready`.

## Outcome

Pending.
