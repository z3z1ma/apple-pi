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

## Three samples, with the cold-read revision (frame2)

`frame2-anthropic.json` is the request at `784f78c6`: sharper evidence kinds, a worked goal and selection cues from the cold read. Totals over three samples of each surface (one sample per case per run):

| Model | Surface | Plan practices | Picked first | Picks named | Per-sample practices |
|---|---|---|---|---|---|
| gpt-6.1-sol | baseline | 73/117 (62%) | 27/90 | 85/90 | 23, 24, 26 |
| gpt-6.1-sol | frame | 98/117 (84%) | 39/90 | 87/90 | 33, 33, 32 |
| gpt-6.1-sol | frame2 | 97/117 (83%) | 39/90 | 88/90 | 30, 34, 33 |
| claude-opus-5-5 | baseline | 91/117 (78%) | 44/90 | 90/90 | 31, 29, 31 |
| claude-opus-5-5 | frame | 111/117 (95%) | 46/90 | 90/90 | 36, 37, 38 |
| claude-opus-5-5 | frame2 | 112/117 (96%) | 45/90 | 90/90 | 37, 37, 38 |

The frame's gain over the baseline is larger than the run-to-run spread: on both models the worst frame sample beats the best baseline sample. frame2 is indistinguishable from frame on this measure; its changes targeted a human reader's confusions, which a plan count does not see. Its worked example also resembles the first goal case, so frame2's score on that case is not independent. Total spend for all runs: about $28.

## What this does and does not show

- It shows that, asked for a plan, both models compose more of the harness's practices under the frame, and pick the specific tool first more often.
- A plan is not behavior. Whether sessions actually call these tools during real work needs real sessions (tool-usage counts in session logs before and after, as in vision.md).
- I wrote the cases and chose the practices after writing the frame, so they can share its vocabulary and my idea of good practice. A held-out set written by someone else would be stronger.
- One sample per case at low reasoning; differences of one or two cases are noise.
- `cold-read.md` holds a person's cold read of the frame, with the confusions it found.
