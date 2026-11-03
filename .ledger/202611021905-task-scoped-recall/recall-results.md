# Indexed recall evaluation

Status: local-prefix candidate comparison complete; relevance judging and actual-tool integration gates pending.

## Frozen setup

- Protocol/harness: `5bfd4f07` (`recall-gate.md`, `engine-replay.mjs`, three public adapter tests).
- Baseline detached revision: `810e8e0d8860919eaa3c8907ef8fa2784e2b6e0f`. Personal-search production source has no diff from reviewed `0843bfd3`.
- Candidate detached revision requested by Tadhg: `f026f6f1`. Hybrid control keeps legacy regex on the baseline engine and sends only NL discovery to the index. No private outcome selected this routing; Tadhg specified it before candidate execution (task-thread message 8242).
- Private scratch root: `/tmp/kofi-index-recall/` (mode0700). Gold and results stay outside Git. Original transcripts/live runtime database are untouched.

## Baseline reproduction

All twelve baseline displayed responses are byte-for-byte identical to the retained prior corrected-source baseline outputs. The frozen-six supplementary relevance and display judgments are reused under that checked equivalence; they are not new independent observations.

| Set | Relevant@5 | General evidence-hit questions | Bounded episode sources@5 | Episode-hit questions | Sufficient actual display |
| --- | --- | --- | --- | --- | --- |
| Frozen six | 10/30 | 5/6 | 7/19 | 4/6 | 2/6, reused judgments |
| Previous held-out six | incomplete: 10 returned sources unjudged | incomplete | 6/20 | 3/6 | unjudged |

The previous experiment stopped after a mandatory episode loss and never completed the previous held-out precision/display labels. That absence remains explicit. The new comparison cannot claim complete non-inferiority from those partial labels.

Latency case selected before candidate results: Q3, largest NL-query prefix among the old twelve, 110,294,070 normalized JSONL bytes. First full current-tool call 404.57 ms; 20 sequential warm full-tool calls p95=407.61 ms. OS cache state is uncontrolled. These are local API calls through a manager facade, not provider/tool-dispatch or live-runtime end-to-end latency.

## Local-prefix candidate observation

Frozen candidate `f026f6f1`, original queries, top five, eligible lineage corpus, `fields: all`:

| Set / route | Baseline bounded-episode sources | Hybrid bounded-episode sources |
| --- | --- | --- |
| Frozen six, indexed NL only | 1 | 1 |
| Frozen six, unchanged regex only | 6 | 6 |
| Frozen six, combined | 7/19 | 7/19 |
| Previous held-out six, indexed NL only | 4 | 7 |
| Previous held-out six, unchanged regex only | 2 | 2 |
| Previous held-out six, combined | 6/20 | 9/20 |

Per-question changes: Q1 gains one episode source, Q4 loses its sole episode source; H4 gains two and H5 gains one. All other episode numerators are unchanged. These aggregate episode counts meet non-inferiority, so they do not justify stopping the inquiry. Q4's regression is retained rather than hidden by the aggregate. General relevance still has six novel frozen hits and incomplete previous held-out labels. No precision or actual-display pass is claimed. Ciaran owns independent source judging under the frozen criteria.

Q3 indexed warm query p95=8.63 ms over 20 sequential repetitions, against full current-tool p95=407.61 ms (47.2x faster). First indexed query 8.55 ms; index construction 734.91 ms; temporary database+WAL+SHM 58,274,176 bytes. This passes the low-level local latency threshold only. It excludes persistent-index construction as predeclared and does not establish production multi-person or end-to-end latency.

Concurrent maintainer reflection changed adapter setup cleanup and removed unused option properties, without changing retrieval. Kofi reran all twelve candidate cases after inspecting that diff: complete private response records are byte-for-byte identical to the initial candidate run. No adverse output was tuned away. Original and check runs, code hashes and timing samples remain privately retained. The five current-engine public tests also passed in Kofi's own rerun.

## Task-set timing and limits

Ciaran authored the new task-scoped set without viewing candidate code/results. Private artifact: `/tmp/ciaran-task-recall/task-heldout-v1-private.json` (mode0600), SHA256 `0452aa7eeab7e0a8e655db9cc5f87f9f937a50a35e2b2b011ebec50e7937feef`, exact JSON without trailing newline, emitted at 2026-11-03T02:35:20.877Z. Six questions cover 49 unique labeled records: 19 relevant, 30 negative, 10 non-message, four distinct histories. Four queries are actual historical calls; two genuine cross-person handoffs use newly authored queries from actual asks and explicit task sets. Their historical other-task access is unknown, so those two are corpus-retrieval cases, not authorization tests. Recorded focus evidence, reconstructed corpus membership and historical requester permission are separate facts.

Kofi independently verified all eight normalized prefix hashes, nine task-span hashes, 49 source hashes, label membership, relevant-ID consistency and cutoff ordering. Reparse of all 37 prior exposure files found zero malformed records and zero overlap with 4,551 selected-prefix identities (200,823 records at verification, 53 new appends after the author's check). Those are provenance checks, not independent relevance judgments. Sampling remains purposive/clustered with named-log and proximal-context cases; copied mail is not independent evidence.

The requested freeze-before-scope-build order was not met: scope implementation `911e2eec` appeared on main while authoring continued. The set can still be frozen before any candidate result inspection, with its independent author unexposed to candidate code. Preserve that narrower claim rather than rewriting timing.

## Integration boundaries

The temporary eligible-prefix index measures local-corpus ranking and low-level query latency. FTS5 collection statistics span the full table even when SQL filters session/span matches; a production multi-session index can rank the same eligible entries differently. Actual intended-corpus/tool checks are still necessary.

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

Public adapter checks (no private data, current engine only):

```bash
node --import ./components/session-state/src/register.mjs \
  --test --test-concurrency=1 \
  .ledger/202611021905-task-scoped-recall/engine-replay.test.mjs
```

The initial three adapter tests passed. Maintainer reflection replaced helper-structure assertions with five replay-level behavioral checks: default historical recovery, all-branch recovery, supplementary relevance labels, frozen-evidence rejection, and failed-setup cleanup. All five passed serially against the detached baseline; rerunning both private sets after the adapter cleanup change preserved all twelve complete response records exactly. The public tests exercise the current engine only; the private candidate observations above are separate evidence, not coverage from those tests. No full suite, provider run, runtime restart or live backfill ran in this evaluation lane.

## Next step

Complete missing source relevance and baseline previous-held-out display judgments. Fiona owns a separate-branch actual tool candidate with SQL eligibility before top-k and the existing formatter. Evaluate its frozen actual output, intended-corpus ranking and end-to-end latency before recommending replacement. Build the explicit multi-source task-corpus control before inspecting task outputs; all four non-inferiority criteria apply separately there, and unknown task permissions cannot satisfy the separate authorization gate.
