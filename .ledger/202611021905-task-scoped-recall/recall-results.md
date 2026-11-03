# Indexed recall evaluation

Status: local-prefix and task-control baseline judging complete; actual-tool integration gates pending.

The decision is whether an indexed `search_session` can replace whole-transcript search without losing measured recall quality. This report records a low-level prototype comparison, not approval of the replacement. [The decision gate](recall-gate.md) defines the metrics, controls and required checks. The two old sets each contain six historical questions; the new task set contains six independently authored task-scoped questions.

## Frozen setup

- Protocol/harness: `5bfd4f07` (`recall-gate.md`, `engine-replay.mjs`, three public adapter tests).
- Baseline detached revision: `810e8e0d8860919eaa3c8907ef8fa2784e2b6e0f`. Personal-search production source has no diff from reviewed `0843bfd3`.
- Prototype candidate detached revision requested by Tadhg: `f026f6f1`. Hybrid control keeps legacy regex on the baseline engine and sends only NL discovery to the index. No private outcome selected this routing; Tadhg specified it before candidate execution (task-thread message 8242).
- Private scratch root: `/tmp/kofi-index-recall/` (mode0700). Gold and results stay outside Git. Original transcripts/live runtime database are untouched.

## Baseline reproduction

All twelve baseline displayed responses are byte-for-byte identical to the retained prior corrected-source baseline outputs. The frozen-six supplementary relevance and display judgments are reused under that checked equivalence; they are not new independent observations.

| Set | Relevant@5 | General evidence-hit questions | Bounded episode sources@5 | Episode-hit questions | Sufficient actual display |
| --- | --- | --- | --- | --- | --- |
| Frozen six | 10/30 | 5/6 | 7/19 | 4/6 | 2/6, reused judgments |
| Previous held-out six | 9/30 | 3/6 | 6/20 | 3/6 | 2/6, newly judged |

The previous experiment stopped after a mandatory episode loss and left previous held-out precision/display incomplete. Ciaran completed those labels in this inquiry under the frozen criteria; these are new judgments, not labels retroactively claimed for the old experiment.

Latency case selected before candidate results: Q3, largest NL-query prefix among the old twelve, 110,294,070 normalized JSONL bytes. First full current-tool call 404.57 ms; 20 sequential warm full-tool calls p95=407.61 ms. OS cache state is uncontrolled. These are local API calls through a manager facade, not provider/tool-dispatch or live-runtime end-to-end latency.

## Local-prefix prototype observation

This section concerns `f026f6f1`, not the later actual-tool landing target. Tadhg's explicit target decision 8301 replaces it with Fiona's forthcoming frozen tool candidate, including `ce4e8808` supported-custom-record extraction and recall-echo demotion. No source-quality or latency pass below transfers to that target; it requires its own observations and judgments.

Frozen candidate `f026f6f1`, original queries, top five, eligible lineage corpus, `fields: all`:

| Set / route | Baseline bounded-episode sources | Hybrid bounded-episode sources |
| --- | --- | --- |
| Frozen six, indexed NL only | 1 | 1 |
| Frozen six, unchanged regex only | 6 | 6 |
| Frozen six, combined | 7/19 | 7/19 |
| Previous held-out six, indexed NL only | 4 | 7 |
| Previous held-out six, unchanged regex only | 2 | 2 |
| Previous held-out six, combined | 6/20 | 9/20 |

Per-question changes: Q1 gains one episode source, Q4 loses its sole episode source; H4 gains two and H5 gains one. All other episode numerators are unchanged. These aggregate episode counts meet non-inferiority, so they do not justify stopping the inquiry. Q4's regression is retained rather than hidden by the aggregate. Ciaran completed general source relevance for both engines: frozen relevant slots 10/30 -> 10/30 and evidence-hit questions 5/6 -> 5/6; previous held-out relevant slots 9/30 -> 10/30 and evidence-hit questions 3/6 -> 3/6. The three aggregate source-quality criteria hold separately on both sets. Actual indexed display remains unverified.

Q3 indexed warm query p95=8.63 ms over 20 sequential repetitions, against full current-tool p95=407.61 ms (47.2x faster). First indexed query 8.55 ms; index construction 734.91 ms; temporary database+WAL+SHM 58,274,176 bytes. This passes the low-level local latency threshold only. It excludes persistent-index construction as predeclared and does not establish production multi-person or end-to-end latency.

Concurrent maintainer reflection changed adapter setup cleanup and removed unused option properties, without changing retrieval. Kofi reran all twelve candidate cases after inspecting that diff: complete private response records are byte-for-byte identical to the initial candidate run. No adverse output was tuned away. Original and check runs, code hashes and timing samples remain privately retained. The five current-engine public tests also passed in Kofi's own rerun.

## Independent source judgments and regression disclosure

Private complete judgments: `/tmp/ciaran-task-recall/index-judging/judgments-v1-private.json`, mode0600, exact JSON SHA256 `f4105b41737fdfb9b9c9ee69ef55786771a230fb0f46d72c6c4b02318bd4e63c`. Ciaran judged all 64 unique question/source pairs, rereading all 20 returned sources absent from supplied labels (two had older withdrawn-ranking judgments). He independently reproduced all 24 complete baseline/candidate outputs and checked corpus, queries, routing and source identity. Kofi independently checked the saved artifact hash, all 64 source-record hashes, ranked membership, display hashes where present, label completeness and relevance counts. This is one semantic rater plus mechanical verification, not inter-rater agreement.

Frozen Q4 loses its sole episode source while Q1 gains one of four. Micro source totals tie, but per-question macro episode recall falls 45.8% -> 33.3%. This is a disclosed regression under the predeclared aggregate gate, not a post-results veto criterion. The three previous-held-out gains are notebook-writing records repeating facts already available in baseline results; they add no evidence-hit question. More recovered records therefore do not establish new facts or better answer coverage.

The explicit multi-source task baseline control is now fully judged: 11/30 relevant slots, 4/6 evidence-hit questions, 6/19 episode sources and 1/6 sufficient displays. In frozen order T1-T6, relevance counts are [4,1,0,3,0,3], episode fractions [2/4,1/3,0/1,2/2,0/4,1/5], and only T4's display is sufficient. Ciaran read all 21 returned sources, including the 12 outside authored episodes, and independently reproduced all six complete control outputs. Private judgments: `/tmp/ciaran-task-recall/task-control-judgments-v1-private.json`, mode0600, exact SHA256 `292bf1281852a14645c2e22b8eb9c1307fb1ef2b7ec51de02e0dce2d94708d3f`. Kofi verified all 21 record hashes, six display hashes/memberships and relevance counts. This is a separately defined control, not an existing cross-person tool capability.

One authored handoff query returns no legacy-regex result despite positive sources in its corpus. The only sufficient control display is proximal design-context recovery, not proof of long-range cross-person recall. Partial source support does not turn attempted edits or expected command success into proof of execution. Baseline queries and labels remain unchanged.

## Task-set timing and limits

Ciaran authored the new task-scoped set without viewing candidate code/results. Private artifact: `/tmp/ciaran-task-recall/task-heldout-v1-private.json` (mode0600), SHA256 `0452aa7eeab7e0a8e655db9cc5f87f9f937a50a35e2b2b011ebec50e7937feef`, exact JSON without trailing newline, emitted at 2026-11-03T02:35:20.877Z. Six questions cover 49 unique labeled records: 19 relevant, 30 negative, 10 non-message, four distinct histories. Four queries are actual historical calls; two genuine cross-person handoffs use newly authored queries from actual asks and explicit task sets. Their historical other-task access is unknown, so those two are corpus-retrieval cases, not authorization tests. Recorded focus evidence, reconstructed corpus membership and historical requester permission are separate facts.

Kofi independently verified all eight normalized prefix hashes, nine task-span hashes, 49 source hashes, label membership, relevant-ID consistency and cutoff ordering. Reparse of all 37 prior exposure files found zero malformed records and zero overlap with 4,551 selected-prefix identities (200,823 records at verification, 53 new appends after the author's check). Those are provenance checks, not independent relevance judgments. Sampling remains purposive/clustered with named-log and proximal-context cases; copied mail is not independent evidence.

The requested freeze-before-scope-build order was not met: scope implementation `911e2eec` appeared on main while authoring continued. The set can still be frozen before any candidate result inspection, with its independent author unexposed to candidate code. Preserve that narrower claim rather than rewriting timing.

## Integration boundaries

The temporary eligible-prefix index measures local-corpus ranking and low-level query latency. A standalone in-memory SQLite diagnostic confirmed that adding another person's rows can change ranking within an unchanged eligible subset, because FTS5 collection statistics span the full table even when SQL filters session/span matches. This is a method limit, not a regression requirement that our task-control CLI must enforce. Actual intended-corpus/tool checks are still necessary.

FTS snippets are diagnostic, not actual `search_session` display. Production eligibility requires the frozen actual-display gate, integrated lineage/issuer selection, permission/membership checks, stable exact recovery and end-to-end query latency. A fast low-level call alone cannot pass those gates.

## Reproduction

From the repository root, with exact detached baseline/candidate source checkouts and private gold/artifacts available:

```bash
node --import ./components/session-state/src/register.mjs \
  .ledger/202611021905-task-scoped-recall/engine-replay.mjs \
  PRIVATE_GOLD PRIVATE_OUTPUT LABEL BASELINE_ROOT \
  current BASELINE_ROOT 0 PRIVATE_SUPPLEMENTARY_JUDGMENTS

node --import ./components/session-state/src/register.mjs \
  .ledger/202611021905-task-scoped-recall/engine-replay.mjs \
  PRIVATE_GOLD PRIVATE_OUTPUT LABEL BASELINE_ROOT \
  hybrid CANDIDATE_ROOT 0 PRIVATE_SUPPLEMENTARY_JUDGMENTS
```

The final judgments argument is optional. For timing, use the privately selected single-question Q3 gold and 20 repetitions. Every run records source/harness/gold hashes, prefix/projection hashes, returned-source membership and raw private outputs. Cleanup removes temporary prefixes/databases, not retained private evidence.

The explicit multi-source task control uses a separate private task gold artifact and retains its report outside the repository:

```bash
node --import ./components/session-state/src/register.mjs \
  .ledger/202611021905-task-scoped-recall/task-control.mjs \
  PRIVATE_TASK_GOLD /tmp/PRIVATE_TASK_OUTPUT BASELINE_ROOT
```

Public adapter/control checks (synthetic data, current engine only):

```bash
node --import ./components/session-state/src/register.mjs \
  --test --test-concurrency=1 \
  .ledger/202611021905-task-scoped-recall/engine-replay.test.mjs \
  .ledger/202611021905-task-scoped-recall/task-control.test.mjs
```

The initial three adapter tests passed. Maintainer reflection replaced helper-structure assertions with five replay-level behavioral checks: default historical recovery, all-branch recovery, supplementary relevance labels, frozen-evidence rejection, and failed-setup cleanup. All five passed serially against the detached baseline; rerunning both private sets after the adapter cleanup change preserved all twelve complete response records exactly. Three task-control CLI checks additionally passed: cross-person recovery with stable source identity/original ordinals and unchanged input bytes, rejection of undeclared task intervals, and rejection of changed frozen evidence. The combined eight checks passed serially against the detached baseline. The standalone SQLite diagnostic remains method evidence rather than a test of task-control behavior. The public tests exercise the current engine only; the private candidate observations above are separate evidence, not coverage from those tests. No full suite, provider run, runtime restart or live backfill ran in this evaluation lane.

## Next step

Baseline judgments are complete. Fiona owns a separate-branch actual tool candidate with SQL eligibility before top-k and the existing formatter. Evaluate its frozen actual output, intended-corpus ranking and end-to-end latency before recommending replacement. The explicit multi-source task-corpus control was frozen before its output inspection and its displays are judged. Compare the actual task candidate against it under decision 8314: task queries match indexed words, including punctuation that would trigger the legacy control's regex heuristic. Decision 8308's initial task-regex refusal is superseded before candidate freeze/results; no unsupported-route loss or gain has been observed. All four non-inferiority criteria apply separately there, and unknown task permissions cannot satisfy the separate authorization gate.
