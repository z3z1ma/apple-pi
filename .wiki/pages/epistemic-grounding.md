# Epistemic grounding

Status: direction, partly adopted. The adopted behavior is a product contract in `docs/tasks.md` (bash `expect`), `docs/change-reflection.md` (run list), and `docs/context.md` (learning-reflection evidence). Measurement lives in `.ledger/202610022036-notebook-learning-loop/`.

## The argument

Thore Graepel argues that LLMs do not reason in a scientist's sense. AlphaGo paired fast intuition (a policy network, System 1) with slow deliberation (tree search, System 2) that tested proposals against their consequences. An LLM only picks the next token; chain of thought is the same process run for longer. He names three gaps:

1. No explicit, inspectable state of beliefs: what is settled, doubted, ruled out, or open.
2. Knowledge and reasoning are mixed in the weights.
3. Chains of thought are often written after the answer, by a different route than the one that produced it.

His remedy is an explicit belief state, reasoning as moves that reduce uncertainty, and an independent evaluator that lets a belief change only when evidence backs it.

## What it means for Apple Pi

The main agent and the pair are two System 1s with different vantage points. The pair adds value through different context and a different model, not through a different kind of reasoning. A third LLM judge would share their failure modes.

Coding has what most open-world fields lack: an environment that executes. Compilers, tests, and the runtime play the role of AlphaGo's search. So System 2 in the harness is **explicit beliefs bound to what actually ran**, not another model.

| Gap | Harness today |
| --- | --- |
| Belief state | Notebook (learnings), ledger (task state), wiki. No live record of hypotheses for the current problem; the `diagnosing-bugs` skill keeps one only transiently. |
| Knowledge and reasoning mixed | Partial mitigation only. Wiki, `AGENTS.md`, and skills externalize project guidance; the model's own knowledge and reasoning stay mixed. |
| Evaluator that gates beliefs | Tests and the runtime; the pair; the consultant's typed confirm/refute/refine/uncertain verdict. |
| Post-hoc reasoning | Predictions are now recorded before results (below). |

## Adopted

- **Bash `expect`.** The agent can predict a foreground command's exit status. A miss is reported as a surprise. The prediction sits in the tool call, before the result, so it cannot be rewritten afterwards. Learning reflection drops predicted failures and keeps surprising successes, which turns the noisy "failure" signal into a precise "surprise" signal.
- **Run list in change reflection.** For each changed code file, the prompt lists what ran after its last change. The host does not classify which runs are checks; the agent judges, and claims only what those runs check.
- **Pair lens.** The pair treats the agent's reasoning and its own notes as claims; a result proves only what it checks.

## Not yet tried

- **A pair that sees only actions.** If reasoning text is written after the fact, showing it to the pair anchors the pair to the driver's story. Measure the pair's precision with the address/decline dispositions that `acknowledge_pair_findings` already records.
- **Search over candidates, only where an automatic scorer exists**, such as performance work with a benchmark. AlphaGo's search worked because evaluating a position was cheap; design choices have no cheap evaluator.
- **A visible hypothesis list** (settled, ruled out, open, each with its evidence) in `diagnosing-bugs`, choosing the probe that would rule out the most hypotheses.

## Rejected

- A third LLM as System 2 judge: still System 1.
- Numeric confidence: verbalized confidence is poorly calibrated; use evidence status.
- Tree search over code edits: test feedback is too slow and too sparse to guide it.
- A stored belief database: the wiki and notebook stay derived from Markdown and session JSONL.
- Hypotheses in the notebook: the notebook holds session learnings, not problem state.

## Open questions

- Does the main agent set `expect` often enough to matter? Count uses and surprises during the learning-loop trial.
- Is the run list too long in long runs? No limit is set until use shows one is needed.

Numbers mined from session logs are proxies; see [[session-log-analysis]].

## Sources

- Thore Graepel, ["Don't be fooled—LLMs don't reason"](https://www.technologyreview.com/2026/10/02/1145639/dont-be-fooled-llms-dont-reason/), MIT Technology Review, 2026-10-02. Fetched from the primary page; a search-engine summary of it attributed study figures the article does not cite.
- Implementation: branch `feat/bash-expectations`, commits `8a5397d` and `097cac6`.
