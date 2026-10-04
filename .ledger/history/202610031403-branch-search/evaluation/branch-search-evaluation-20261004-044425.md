# Branch search evaluation, 2026-10-04T04:44:25.177Z

- Model: anthropic/claude-opus-5-5 (profile coding, thinking medium)
- Configuration: `/Users/alexanderbut/code_projects/personal/apple-pi/.ledger/202610031403-branch-search/evaluation/pilot.json`
- Ran from 2026-10-04T04:44:25.177Z to 2026-10-04T05:50:30.971Z
- Tasks evaluated: 1; skipped: 0
- Wall-clock (run) is the arm's run alone: the single trajectory, or the whole search including its own scoring; it leaves out making the clone and the final oracle scoring.
- Cost: tokens are input + cache read + cache write + output. Est. cost is main-model-equivalent, not actual spend: it prices every token at the evaluated model's rates (USD per million: input 4, output 20, cache read 0.2, cache write 5); a scorer review or fidelity tag that ran on another profile is priced the same way, so its real price may differ. Fidelity tags are an evaluation cost outside the arm's totals; the Fidelity column prices them beside the tags, and the summary adds them.
- Arms: A is one trajectory (one prompt, `branch.limits` as its budget). B searches with `draw: "model"`, C with `draw: "random"`; `-oracle` runs use the oracle gates as the scorer (no review), `-authored` runs let the model author it. Every final state is scored with the oracle gates; solved means every oracle gate passes.
- Winner rank: the position of the winner's root ancestor (the winner itself for a root) in the model order of the root enumeration: 0 is `preferred`, then the other candidates in returned order. Tail win (conservative): arm C solved the task, that root is not `preferred`, and its position is at or beyond the most roots B's configuration could ever draw (`branches.perGeneration + generations.maxDepth × generations.rootsPerGeneration`, at most `branches.maxTotal`), so no B run could have reached it.

## Results

### `202610031136-subagent-resume-policy`

Base `f92bb2a9e003`, final `69ef926cdebe` (override, 1 commits); oracle gates: `components/subagents/tests/subagent-runner-e2e.test.ts` (`./node_modules/.bin/vitest run --config .apple-pi-eval/vitest.config.mjs --root . components/subagents/tests/subagent-runner-e2e.test.ts`), `components/subagents/tests/subagents.test.ts` (`./node_modules/.bin/vitest run --config .apple-pi-eval/vitest.config.mjs --root . components/subagents/tests/subagents.test.ts`)

| Arm | Solved | Outcome | Oracle gates | Total tokens | Cache read tokens | Wall-clock (run) | Est. cost (USD, main-model rates) | Winner rank vs preferred | Tail win | Fidelity |
|---|---|---|---|---|---|---|---|---|---|---|
| A | no | stop | 0/2 | 58,180 | 37,498 | 17.3 s | 0.124732 | — | — | — |
| B-oracle | no | no survivor | 0/2 | 3,050,701 | 2,900,426 | 816.7 s | 1.885664 | — | — | — |
| B-authored | no | ready | 1/2 | 2,458,395 | 2,263,004 | 1122.9 s | 2.198876 | — | — | — |
| C-oracle | no | no survivor | 0/2 | 2,098,597 | 1,961,713 | 501.6 s | 1.574264 | — | no | — |
| C-authored | no | ready | 1/2 | 3,085,389 | 2,889,635 | 1232.1 s | 2.311783 | 3 (c4; preferred c1) | no | — |

## Summary

| Arm | Solved | Total tokens | Cache read tokens | Wall-clock (run) | Est. cost (USD, main-model rates) | Fidelity tag tokens (USD, main-model rates) | Tail wins |
|---|---|---|---|---|---|---|---|
| A | 0 of 1 | 58,180 | 37,498 | 17.3 s | 0.124732 | 0 (0.000000) | — |
| B-oracle | 0 of 1 | 3,050,701 | 2,900,426 | 816.7 s | 1.885664 | 0 (0.000000) | — |
| B-authored | 0 of 1 | 2,458,395 | 2,263,004 | 1122.9 s | 2.198876 | 0 (0.000000) | — |
| C-oracle | 0 of 1 | 2,098,597 | 1,961,713 | 501.6 s | 1.574264 | 0 (0.000000) | 0 |
| C-authored | 0 of 1 | 3,085,389 | 2,889,635 | 1232.1 s | 2.311783 | 0 (0.000000) | 0 |

## Success criteria

- [ ] C solves more tasks than A (oracle scorer): C 0 of 1 (2,098,597 tokens, 1,961,713 cache read, 501.6 s, $1.574264), A 0 of 1 (58,180 tokens, 37,498 cache read, 17.3 s, $0.124732)
- [x] C solves at least as many tasks as B (oracle scorer): C 0 of 1 (2,098,597 tokens, 1,961,713 cache read, 501.6 s, $1.574264), B 0 of 1 (3,050,701 tokens, 2,900,426 cache read, 816.7 s, $1.885664)
- [ ] Tail wins occur (oracle scorer): 0 (0 tokens, 0 cache read, 0.0 s, $0.000000). C solved 0 task(s) that A did not; the preferred candidate won 0 of them.
- [ ] C solves more tasks than A (authored scorer): C 0 of 1 (3,085,389 tokens, 2,889,635 cache read, 1232.1 s, $2.311783), A 0 of 1 (58,180 tokens, 37,498 cache read, 17.3 s, $0.124732)
- [x] C solves at least as many tasks as B (authored scorer): C 0 of 1 (3,085,389 tokens, 2,889,635 cache read, 1232.1 s, $2.311783), B 0 of 1 (2,458,395 tokens, 2,263,004 cache read, 1122.9 s, $2.198876)
- [ ] Tail wins occur (authored scorer): 0 (0 tokens, 0 cache read, 0.0 s, $0.000000). C solved 0 task(s) that A did not; the preferred candidate won 0 of them.
