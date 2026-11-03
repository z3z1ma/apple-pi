# Indexed recall evaluation

Status: candidate 1 fails the latency gate, independently reproduced. The operator stopped further gate work and chose candidate 2 for main without another gate run.

The decision is whether an indexed `search_session` can replace whole-transcript search without losing measured recall quality. This report keeps the low-level prototype comparison separate from the frozen actual-tool evaluation; neither is approval of the replacement. [The decision gate](recall-gate.md) defines the metrics, controls and required checks. The two old sets each contain six historical questions; the new task set contains six independently authored task-scoped questions.

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

## Actual-tool observations

Frozen candidate: `2ade19c932dfc40ce012e13850a9d43baa2a5ec2`; actual replay harness: `905211b2`. All 36 captures exist: each six-question set under local full-prefix and fixed contemporary-background conditions. Every selected prefix hash matches between conditions; total indexed-row arithmetic matches snapshot rows minus selected persons' replaced rows plus their local prefix rows in all 18 comparisons. Returned sources have no observed membership or ordinal violation. These are setup/address checks, not general relevance or display judgments.

| Set | Baseline episode sources | Actual local | Actual fixed background |
| --- | ---: | ---: | ---: |
| Frozen six | 7/19 | 7/19 | 7/19 |
| Previous held-out six | 6/20 | 9/20 | 8/20 |
| New task six | 6/19 | 10/19* | 7/19 |

`*` Task-local T2 returned an indexed-search database-lock error, with missing details and `toolError:false`. Its empty result is a failed retrieval, not a normal no-match or semantic-quality observation. The retained capture is not replaced by later success. Actual-tool general relevance, evidence-hit counts and display sufficiency are still unverified; no source-quality pass follows from this table.

### Mandatory end-to-end latency

The same preselected Q3 query and 110,294,070-byte historical prefix were used. Each actual-tool condition has one separately reported first call and 20 serial warm calls, with identical complete outputs throughout. Nearest-rank p95 is the 19th sorted warm observation; OS cache is uncontrolled, not cold-disk state.

| Path | First call | Warm p95 | Speedup vs 407.61 ms baseline | Gate |
| --- | ---: | ---: | ---: | --- |
| Actual tool, local prefix | 79.85 ms | 67.50 ms | 6.04x | fails <=50 ms |
| Actual tool, fixed background | 191.98 ms | 201.31 ms | 2.02x | fails <=50 ms and >=5x |
| Independent fixed-background replay | 220.12 ms | 236.83 ms | 1.72x | fails <=50 ms and >=5x |

The gate requires BOTH <=50 ms AND >=5x. Low-level SQL's earlier 8.63 ms does not transfer to this full path. Ciaran independently reproduced the background failure and verified baseline timing arithmetic, without independently rerunning baseline timings. Kofi checked exact candidate/harness/background/gold identities, complete response/metadata/parameter/prefix equivalence and p95 arithmetic against the 15,263-byte independent artifact (SHA256 `f8cbf27aa07f4653c07363cc701c2f936c9c291bb7afb0a2265ea3bb6a1cb4c6`). Tadhg accepted the failure/no activation in message 8400. Under the declared stop rule, the confirmed mandatory failure stopped nondecisive semantic/display judging. Shared host load and OS cache are uncontrolled; this is a bounded gate failure, not typical-latency estimation or independently diagnosed root cause.

Local setup took 1,267.72 ms, including 688.66 ms indexing; index size was 49,246,208 bytes. Background setup took 4,088.54 ms, including 263.21 ms snapshot copy and 3,205.91 ms selected-session replacement/indexing; resulting index size was 785,793,024 bytes. These costs are outside warm calls. Snapshot backup itself took 1,458.22 ms; that is not a full backfill measurement. The accepted background covers 116 indexed transcripts of 123 known to the live runtime and holds contemporary other-person statistics, not a reconstructed historical organization.

Private captures: `/tmp/kofi-index-recall/{frozen,heldout,task}-actual-{local,background}-private.json`; latency: `latency-actual-{local,background}-private.json`. Original queries, source records, code identities and outputs remain retained privately.

### Independent stop and remaining judgments

Ciaran mechanically checked all 24 old-set captures against frozen gold, source/harness identities, original parameters, prefix eligibility, ordinals and printed markers. Fifty of 53 unique question/source pairs reused prior single-rater labels under original-record hashes; three novel pairs remain unjudged. Twelve displays reused baseline judgments by exact response hash; twelve nonidentical old-set displays and task quality remain unjudged. No new semantic labels were authored and the task metadata audit is incomplete. Stop artifact: `/tmp/ciaran-task-recall/actual-tool-stop-judgments-v1-private.json`, 32,641 bytes, mode0600, SHA256 `e30dfffc137130748db0c4c2bb2d624eaa6a780b9b64059177d00b0972d5c75f`. The original task-local lock failure is retained and was not independently reproduced or diagnosed by Ciaran.

Method correction: an initial claim that H3/H6 had five local hits was an unchecked assumption. Both actual local and background captures have zero; 20 repeated background calls matched local IDs/text exactly. The claim was withdrawn and the judging goal corrected; no code change or candidate fix followed.

## Operator closeout

Candidate 1 stays frozen and unactivated. Candidate 2 is separately authorized (message 8405), with Fiona owning its tool branch and Tadhg the index changes: baseline stopword alignment, FTS-indexed session filtering, per-entry direct byte reads and reader busy timeout; real retrieval failures take the native tool-error path. These are implementation changes, not measured acceptance. The operator directed landing on main without another gate run (message 8432); gate work is finished. No earlier pass transfers.

The new preselected latency case is Q4, the largest remaining NL prefix from a different history than Q3, chosen by size before any candidate-2 output: 83,908,166 bytes. Both cases require <=50 ms AND >=5x, using the original queries/cutoffs and 20 serial warm calls. Q4's newly measured baseline first call is 242.29 ms and warm p95 152.96 ms. Its complete response matches the retained original baseline. All three source-quality sets now serve as exposed regressions, not fresh confirmation. Actual tool/field/permission checks and all four quality criteria remain required; unknown historical task permissions remain unknown.

The gate records the separately captured v3 contemporary background. Its corpus differs from the v2 snapshot, so a future candidate-2 improvement cannot be attributed solely to code changes. The planned further freeze/replay was cancelled by operator direction. No candidate-2 gate result exists in this report; landing remains Fiona and Tadhg's work.
