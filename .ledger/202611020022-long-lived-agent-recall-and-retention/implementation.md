# Measured recall implementation and ranking rollback

Date: 2026-11-02. Measurement owner: Kofi Bhattacharya. Implementation owner: Delphine Lightfoot. Independent relevance judge: Ciaran Gallo.

## Current state

Extraction, stable addressing and presentation fixes remain on main. The query/ranking increment was withdrawn in `25c1d229` after it lost historical evidence on the frozen questions. Rollback production source equaled presentation revision `892156ef` except two ancestry labels corrected from "question" to "preceding input". Review corrections now add native nested-issuer exclusion, saved-program full recovery and structural label provenance in `0843bfd3`. Frozen outputs remain byte-identical to the rollback on all six questions. Fix-verification review is complete with no findings or coverage gaps; completion and operator acceptance remain separate.

## Authorization

Tadhg's operator-decision mail in thread `t-9dac42ef-fdff-47d3-b412-57afb40ec195`, sequence 7603, authorized extraction/exact addressing, answer-bearing context, then predictable query semantics/ordering. After measurement, sequence 7652 directed immediate ranking rollback, retaining the earlier fixes and requiring no baseline metric loss. Sequence 7659 authorizes a later isolated ranking/answer-context experiment after the retained-source review: it lands only after beating the frozen baseline and a fresh held-out set written before inspecting results.

Storage/archive prototypes remain deferred. Cloud backup is an eventual preference, not implementation scope. Fiona and Tadhg own runtime.ts/schema.ts changes; this lane leaves them alone.

## Method

Baseline source: `fff5eef202bb17256971e9fdb3def081d8e77b19`. Baseline focused validation: 86 tests in 10 files, one worker. The six private questions, historical cutoffs, original labels and bounded episodes remained fixed throughout.

Each measured revision has a detached checkout with installed dependencies supplied by a node_modules symlink. `tool-replay.mjs` parses original JSONL read-only, writes a private historical prefix ending at the issuing assistant entry, calls the actual production tool through a read-only manager facade, captures its displayed response and removes the temporary prefix. It includes original custom/summary/notebook records rather than reconstructing only messages. SessionManager.open is intentionally avoided because the installed loader can repair or migrate originals.

Prefer production details.hits or details.sources for result identity; only older releases require parsed display headers. A metadata/header audit of every measured presentation/ranking/rollback response found identical top-five sets, although formatting sometimes changed their within-page order. Earlier aggregate counts are unaffected.

New top-five hits remain unjudged until Ciaran reads their full original entries against the frozen question. Full-entry relevance, labeled-episode recovery and displayed sufficiency are separate measures. Private questions, responses, mappings and labels stay outside Git; committed artifacts contain scripts and sanitized measurements only.

The syntax-migrated variant preserves the old punctuation heuristic by adding the proposed regex: prefix where it applied. That includes a dotted term as well as two intentional alternation queries. It is reported separately from unchanged calls, not counted as an unchanged-input improvement. After rollback only original calls apply; the explicit prefix is withdrawn.

## Measured sequence

| Frozen source | Calls | Relevant top five | Any evidence hit | Episode evidence | Sufficient display |
| --- | --- | --- | --- | --- | --- |
| Baseline fff5eef2 | Original | 9/30 | 5/6 | 7/19 | 2/6 |
| Extraction e833784d | Original | 9/30 | 5/6 | 7/19 | 2/6 |
| Presentation 892156ef | Original | 10/30 | 5/6 | 7/19 | 2/6 |
| Query/ranking 323c33ec | Unchanged | 11/30 | 5/6 | 3/19 | 1/6 |
| Query/ranking 323c33ec | Explicit-regex migration | 10/30 | 5/6 | 3/19 | 1/6 |
| Retained rollback 25c1d229 | Original | 10/30 | 5/6 | 7/19 | 2/6 |
| Review corrections 0843bfd3 | Original, identical displays | 10/30 | 5/6 | 7/19 | 2/6 |

### Retained extraction and addressing

`e833784d` adds supported custom messages, compaction/branch summaries, notebook text and array-edit discovery; stable entry:<id> line continuation; message zero; and source metadata without renumbering historical #N ordinals. Builder validation: 88 tests in 11 files, Node TypeScript and scoped Biome checks passed. Two novel permission-related hits were independently rejected under the original question; quality metrics did not change on this small set. This is a tested coverage/addressing repair, not measured general recall improvement.

### Retained presentation and chronology correction

`892156ef` selects meaningful-term passages, labels thinking/attempt/result evidence, exposes original source IDs and ancestor/call links, excludes the issuing entry, demotes prior recall output and preserves full direct/nested arguments on exact reads. Builder validation: 93 tests in 12 files, Node TypeScript and scoped Biome checks passed.

One new relevant derivative statement replaces a recall echo. It increases precision by one entry, but neither recovers an additional labeled-episode source nor makes a previously insufficient response sufficient.

Ciaran found that a link labeled "question" could refer to a notification, learning packet or unrelated preceding input. Kofi reproduced this with a public notification-to-assistant case, observed the wrong label, then corrected it to "preceding input" in `323c33ec`. This is chronology, not inferred causal provenance. The correction survives the rollback.

`dff2b972` strengthens retained tests at the public tool seam: assert actual evidence/source addresses instead of echoed query terms, follow exact-source continuations and inspect complete payloads. Tests for the withdrawn query/ranking contract were removed with that contract, rather than left as assertions against a discarded approach.

### Withdrawn query/ranking increment

`bd0d5d33` introduced literal default, explicit safe regex, one ranked pipeline, broader pageable candidates and validated narrowing filters. Its source plus the chronology correction was frozen at `323c33ec`. Builder and independent focused checks passed, including Node/web typecheck, but those checks did not establish retrieval quality.

Independent frozen evaluation found one newly sufficient question and displaced historical/provenance evidence in three others. Higher topical precision came partly from repeated or derivative premises; it was not independent corroboration or improved historical reconstruction. Both unchanged and migrated variants lost episode evidence and sufficient displays. Neither supports a broad quality-gain claim.

Tadhg directed rollback. `25c1d229` reverses that coherent query/ranking/filter/page increment and preserves the earlier fixes. Legacy heuristic query detection, ranking and discovery limits remain. No exhaustive-pagination or literal-default claim remains in runtime/docs. One diagnostic ranking assertion from the withdrawn algorithm failed after rollback and was removed with that contract; it is a known example for a future experiment, not a passing legacy guarantee.

### Rollback confirmation

Kofi replayed all six original calls from detached `25c1d229`. Both Kofi and Ciaran independently checked that question IDs, parameters and top-five source lists equal the judged presentation snapshot. All six displayed responses are byte-identical after only the chronology-label substitution. Presentation judgments therefore carry by verified equivalence; these are reused judgments, not six fresh independent observations.

Every reported aggregate metric is at or above baseline. Per-question episode recall and displayed sufficiency also return to baseline. The sole gain is one relevant restatement: precision 10/30 rather than 9/30. No episode-recovery or displayed-sufficiency gain is established.

### Retained-source review and corrections

Review `review-d35868a7-9709-4ee0-be8e-641b9f090a5c` confirmed five distinct issues: saved-program traces missing from full entry/expand recovery; native nested calls matching their own parent request; touched discovery bypassing issuer exclusion; quoted payload labels promoted into false structural provenance; and an unqualified regex-ordering documentation promise. Three independent inspections and challenges confirmed the allegations. Its execution was incomplete at 7/8 questions because the integration reader had not reconciled a then-running fidelity report. The old artifact remains defective and that missing question remains visible.

Kofi added public regressions, observed nine red cases on the retained source, and committed `0843bfd3`:

- Decode supported traces independent of the enclosing registered tool name, including saved programs.
- Share discovery eligibility for history/file/touched modes; recognize native caller/n descendant identities. Exact recovery stays ahead of exclusion.
- Carry structural section coordinates beside searchable text instead of scanning payload lines for label-like prefixes. Legacy query scoring/selection remains unchanged.
- Qualify original-before-recall ordering as natural-language-only; regex retains legacy chronological/capped behavior.

Tests include real isolated scripted AgentSessions at one and two nested levels; no paid model/provider or live operator session was used. Frozen replay from detached `0843bfd3` has identical top-five sets and byte-identical displays to the judged rollback for all six questions. Reused judgments therefore give the same metrics, not six new independent observations.

## Validation and review

Independent post-rollback checks passed:

- 92 tests in 14 files: all session-search tests plus standalone/extension integration seams, --maxWorkers=1.
- npm run typecheck: Node and web.
- Scoped Biome check of session-search source/tests.
- Diff whitespace checks and context_lint: 371 context files.
- Frozen actual-tool replay and independent equivalence confirmation described above.

No full suite, downstream model-use trial, archive migration, daemon restart or original-transcript mutation was performed. Entry continuation is line-based, not byte-bounded; a single huge rendered line remains a disclosed limit. Existing #N:path recovery can read content-bearing payloads by their content lines.

Post-correction validation passed: 101 tests in 15 files, one worker; Node/web typecheck; scoped Biome; diff whitespace; context_lint (371 files). The red/green logs and new native nested-dispatch regressions distinguish a real failure signal from merely accepting a thrown tool error.

The initial review `review-5cbfc262-cc9e-4bde-b4a6-fbb37793395f` captured withdrawn source and was cancelled with no completed question. Retained-source review `review-d35868a7-9709-4ee0-be8e-641b9f090a5c` is incomplete with five confirmed findings, all now recorded fixed against `0843bfd3` using completed, unchallenged new-target questions rather than erasing the original allegations. Fix-verification review `review-60642218-ae89-4998-8b20-d76bcc523d4f` captures `25c1d229..0843bfd3` and explicitly requires both correction verification and the original end-to-end reconciliation on corrected source. All earlier sealed reports are available for that comparison. No old coverage or approval transfers. The new review completed 3/3 passes and 7/7 questions with zero findings/gaps. The former reconciliation omission is closed on this corrected target, while the old review retains its original incomplete execution history.

Independent first inspections added public mixed-source/fork/recovery matrices, real native dispatch at direct/one-level/recursive depths, and positive historical controls as well as issuer-negative controls. One matrix executed 468 public searches; another focused run passed 131 tests including actual Monty saved/direct trace generation and failure recovery. Other probes verified unsupported envelopes, 24-operation complete recovery, children, section boundaries and regex/natural-language ordering. Exact-base runs reproduced the corrected defects. Independent challenges checked retained code/log identity and evidence rather than claiming to rerun those tests. Their conclusions agree within this bounded synthetic contract; they do not prove general retrieval accuracy, downstream use, every production lifecycle or operator approval.

## Next experiment boundary

After the retained-source review settles and material findings are addressed, ranking/answer-context work may proceed only in an isolated branch/worktree. Freeze fresh held-out questions, cutoffs, labels, baseline and success criteria before inspecting candidate results. Keep frozen and held-out results separate; preserve a negative outcome. No candidate lands on main before it beats baseline on both sets under the predeclared quality gate. The already inspected toy ranking example is diagnostic, not held-out evidence.
