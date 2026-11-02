# Independent recall evaluation

Date: 2026-11-02. Evaluator: Ciaran Gallo, Scientific Skeptic. Saved by Kofi from evaluator report in task thread, sequence 7526.

## Conclusion

The checked histories demonstrate useful recovery, but not reliable first-response recall. Finding a relevant entry, showing the decisive passage, and the agent using it are different outcomes. A known notebook ID can resolve correctly while its cited sources do not support the learning. An agent can report that compaction lost a fact which is still present in its active compaction summary.

This is a bounded historical audit, not a measurement of today's implementation, whole-transcript recall, or downstream engineering quality. Kofi owns current-code historical-prefix replay; those results remain separate.

## Method and coverage

Read current search loader/ranking/tool flow, notebook source resolver/formatter, compaction packet, and mail search. Search reads message records and searches text, thinking, call arguments and nested execution evidence, with extraction gaps independently probed by Kofi. Text discovery and known-index/file expansion are different paths. Notebook source lookup resolves references, not semantic entailment. Mail search is case-insensitive literal substring matching over accessible bodies, ordered by sequence.

Inventoried 707 JSONL files in the project-associated session directory: 2,745,425,666 bytes, 138 files with compactions, 145 direct `search_session` calls, seven direct `revisit_note` calls, no direct `search_messages` calls, and two parse-failed lines. This is narrower than Kofi's all-session inventory. Nested calls, other projects and raw pair activity are outside these counts.

Initially selected the six largest project transcripts, yielding 16 paired search calls. Size proved a poor proxy for long-lived work: several roughly 90-100 MB files had one compaction and fewer than 650 records. Retained this sample rather than silently replacing it. Added eight search calls at fixed ordinals 1, 6, 11, 16, 21, 26, 31 and 38 from the project transcript with 24 compactions, and all seven direct notebook lookups. Total: **31 call/result pairs: 24 searches and seven notebook lookups**. The searches came from four transcripts and followed one to 39 physical compaction records; they are clustered, not 24 independent sessions.

Inspected issuing reasoning/preceding context, original result and relevant earlier records. A gold set is a fixed question set with independently assigned relevance labels for comparing retrieval results. Six actual questions received bounded gold: all **38 entries** in six source episodes labeled, including **19 relevant**, and all **30 historical top-five entries** relevance-labeled. Gold holds private session path, issuing entry/line, actual parameters, episode labels, result hash and snippet label. Cases were chosen for answerable historical questions and inspectable episodes, not randomly. Negative and partial cases were retained.

Private questions, content, queries and source mappings remain in `/tmp/ciaran-recall-audit/`; `private-gold.json` is the replay input. Originals were read only. No model replay, live daemon change or production edit occurred in this lane.

## Definitions

- **Relevant full entry:** substantive answer evidence, not topic overlap. Fetch requests do not prove a URL exists; execution does not prove permission; code alone need not explain a decision. Scope matters.
- **Precision@5:** relevant full entries among five returned entries, not visible-snippet evidence.
- **Evidence hit@5:** at least one relevant full entry among five.
- **Episode-relative recall@5:** relevant retrieved entries from the labeled episode divided by its complete relevant set. This is not whole-transcript recall.
- **Snippet sufficient:** actual response contains enough evidence to answer without another expansion/read. A locator alone is insufficient.
- In wider observations, **partial** means useful incomplete evidence/locator; **no-answer** means unrelated/self-only; **refusal** means rejected query. Exact navigation is separate.

## Six-question gold

| Case | Episode entries / relevant | Relevant top-five | Episode relevant retrieved | Snippet sufficient |
| --- | ---: | ---: | ---: | --- |
| Q1 | 10 / 4 | 1 / 5 | 0 / 4 | No |
| Q2 | 5 / 4 | 1 / 5 | 1 / 4 | No |
| Q3 | 5 / 3 | 0 / 5 | 0 / 3 | No |
| Q4 | 2 / 1 | 2 / 5 | 1 / 1 | No |
| Q5 | 8 / 3 | 3 / 5 | 3 / 3 | Yes |
| Q6 | 8 / 4 | 2 / 5 | 2 / 4 | Yes |

- Precision@5: **9/30 = 30%**.
- Evidence hit@5: **5/6**.
- Labeled-episode hit@5: **4/6**.
- Micro episode-relative recall@5: **7/19 = 36.8%**; macro: **45.8%**.
- Delivered-snippet sufficiency: **2/6**.

Q1/Q4 have relevant returned entries outside the bounded source episode; the two hit numerators intentionally differ. Complete relevant sets as one-based episode positions: Q1 {1,2,8,9}; Q2 {1,2,4,5}; Q3 {3,4,5}; Q4 {2}; Q5 {1,6,8}; Q6 {1,6,7,8}. All other episode positions are negative.

These describe checked questions, not product accuracy or an improved-ranker claim.

## Wider observations

The 24 searches comprise 17 topical queries (one page-two), two file discoveries and five known-index/file expansions.

- Topical: four sufficient, nine partial, three no-answer, one unsafe-regex refusal. First-page only: four sufficient, eight partial, three no-answer, one refusal (16 requests).
- Both file discoveries yielded locators, not the full requested artifact.
- Four expansions recovered useful requested evidence. One returned real but irrelevant records because the agent requested wrong indices; this is not an expansion correctness defect.

Opaque cases: C1 self-only query/reasoning; C2 one relevant result mixed with recall echo and lexical noise; C6 wrong-index expansion; C10 unsupported-query rejection; C11 primary-source instruction found after reformulation; C13 exact old file recovery (not current-file truth); C14 relevant entries with decisive checklist hidden in snippets; C16 historical decision rationale not evident in current code.

Seven notebook lookups: five structural `ok`, two `not_found`. Separately checked semantic support: one substantive support, three partial support, one unrelated evidence; unresolved IDs yielded none. This tiny purposive sample includes passive/closeout use, not seven topical questions.

**E3:** result said `ok`, `partial:false` with three resolved source entries. Independent check of the original observation confirmed the claim and source IDs matched the lookup, but those entries were unrelated documentation/tool exploration. Stable resolution did not establish support. E13 supported a failure but not the claimed successful retry. E14 returned about 245,000 characters across 51 entries, much before the pertinent failure; this measures burden, not task-success or latency effects.

## Compaction and mail

Checked three latest ancestor compaction summaries selectively, tracing parent IDs to ensure active ancestry. In C14 the agent said details were lost, while the active summary still listed eight named checklist items. This refutes that specific loss explanation, not all summary loss or inattention. Three selected checks are not a summary-quality rate.

No historical direct mail-search task was available. Source was read; relevance, cross-thread answerability and permission-sensitive recovery were not scored. This evaluator queried no live mailbox/database.

## Claims and falsifying checks

| Claim | Audit result | Next discriminating check |
| --- | --- | --- |
| Nonempty results establish recall | Refuted by self-only/unrelated cases | Keep sufficiency separate from nonempty counts |
| Relevant ranked entry supplies decisive evidence | Refuted by Q2/Q4 | Compare full-entry hit with current visible snippets and expansion effort at frozen cutoffs |
| Resolved sources support a learning | Refuted by E3 | Independently label claim-to-source support before changing source selection |
| Compaction caused reported recall failure | One specific claim contradicted; generally unestablished | Exact-summary answerability on C14, then actual agent use |
| New ranking/chunking improves recall | Untested | Frozen six-query replay, judging new outside-episode hits before calculating precision |
| Archives safely replace original access | Untested | Disposable-copy exact-ID/file/notebook recovery plus topical checks; byte identity or explicit unavailable |

Baseline before presentation/ranking comparisons; disposable-copy retention checks afterwards. This is research sequencing, not a mandate for a new storage engine or measured economics.

## Limits

One subjective evaluator; no inter-rater agreement. Inferred intent varies in confidence. Correlated queries, project-only size/compaction-depth selection and model/tool eras limit generality. Answerable inspectable episodes are easier to label; retained failures mitigate but do not remove selection bias. Historical code differs from current code. Files may append between snapshots; parse failures were counted. Episodes are not exhaustive transcript relevance. Opaque cases require private mappings. Returning evidence does not prove its correct use. No downstream defect, task-success, cost or live-latency conclusion follows.

No production tests ran in this lane. Executed work was local inventory/pair extraction, reading, manual evidence labeling and ancestry validation.

## Current replay follow-up

Kofi separately replayed all six frozen historical cutoffs with today's production functions, including the issuing assistant entry as the deployed path does. It reproduced precision@5 **9/30** and episode-relative recall@5 **7/19**. A prototype that only excludes the issuing entry introduced two new top-five entries (Q3/Q4); Ciaran read both and labeled both irrelevant. Current displayed snippets remain sufficient only for Q5/Q6. Thus issuer exclusion alone has **no measured precision, episode-recall or snippet-sufficiency gain on these six questions**. It replaces two irrelevant issuer hits with two other irrelevant hits. This negative result stays separate from the historical audit and from the broader contamination diagnostics.
