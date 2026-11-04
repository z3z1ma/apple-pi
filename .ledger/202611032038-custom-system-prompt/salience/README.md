# Salience and composition: baseline prompt versus the operating frame

`eval.mjs` sends the same requests to two captured prompt-and-tool surfaces and compares which tools the model says it would call. No tool runs; it asks for a plan.

- **Baseline** (`baseline-anthropic.json`): the real request at `fff4a416`, before the composer (Pi's preamble, tool list and rules). Captured from a worktree at that commit with `capture.mjs`, which points the package at the checkout it runs in.
- **Frame** (`frame-anthropic.json`): the real request at `e2db6816`, the operating frame.
- Both are captured in the same agent configuration and project; each carries its own system prompt and tool definitions.

Two measures:
- **Picks** (30 cases): a request that one tool or a small set serves; does the plan name it, and is it first?
- **Plan practices** (8 open goals, 39 practices): an ordinary goal ("fix the flaky upload test"); does the full plan include the practices the harness exists for: take the task, check what is known, an independent review, a link, a finish, the right fan-out?

## Results (2026-11-04, reasoning low, one sample per case)

| Model | Surface | Picks named | Picked first | Plan practices | Cost |
|---|---|---|---|---|---|
| gpt-6.1-sol | baseline | 28/30 | 9/30 | 23/39 | $1.68 |
| gpt-6.1-sol | frame | 30/30 | 14/30 | 33/39 | $1.64 |
| claude-opus-5-5 | baseline | 30/30 | 15/30 | 31/39 | $1.13 |
| claude-opus-5-5 | frame | 30/30 | 16/30 | 36/39 | $1.02 |

Per goal, no plan got worse on either model. The gains are in the ordinary goals: on GPT-6.1 the flaky-test plan went from 2/5 to 5/5 (it now checks notes, reviews, links and finishes), the backoff change and the rename from 2/5 to 4/5. Named picks were near the ceiling already: when a request names its need, both surfaces find the tool; the frame makes the model reach for it first more often (GPT-6.1: 9 → 14).

## What this does and does not show

- It shows that, asked for a plan, both models compose more of the harness's practices under the frame, and pick the specific tool first more often.
- A plan is not behavior. Whether sessions actually call these tools during real work needs real sessions (tool-usage counts in session logs before and after, as in vision.md).
- I wrote the cases and chose the practices after writing the frame, so they can share its vocabulary and my idea of good practice. A held-out set written by someone else would be stronger.
- One sample per case at low reasoning; differences of one or two cases are noise.
- `cold-read.md` holds a person's cold read of the frame, with the confusions it found.
