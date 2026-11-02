Status: retained implementation independently reviewed; isolated ranking experiment preparing held-out questions
Created: 2026-11-02
Updated: 2026-11-02

# Retrospective

## What mattered

Two independent investigations separated retrieval quality from retention integrity. The all-session inventory and current-code historical-prefix replay were kept distinct from a project-scoped, manually labeled historical audit. Six real questions had 30% top-five entry precision but only two sufficient displayed answers; exact navigation was more useful than broad discovery. The result does not establish product-wide accuracy.

The cheapest prototype, excluding the issuing search entry, removed two irrelevant hits but replaced them with two others. It produced no measured precision, episode-recall or snippet-sufficiency gain on the frozen gold. Preserving that negative result prevented a convenient mechanism from becoming an unsupported solution claim.

## Implementation result

Approved extraction/addressing and presentation fixes passed focused tests. The later unified query/ranking pipeline also passed tests, yet the frozen evaluation showed topical precision rising while episode evidence fell from 7/19 to 3/19 and sufficient displays from 2/6 to 1/6. Treating precision alone as success would have shipped a historical-recall regression. Tadhg directed rollback. Retained `25c1d229` restores 7/19 and 2/6, with one additional relevant restatement (10/30 precision versus 9/30). Both owner and independent judge verified the rollback's response equivalence to the earlier presentation snapshot. Reused labels under that equivalence are not new independent observations.

The retained-source review then found real gaps despite green tests: saved-program full recovery, nested caller identity, touched-mode eligibility, payload-label impersonation and a regex-ordering doc overclaim. Nine public regression cases went red before corrective `0843bfd3` and green afterward, including actual native nested execution at two depths. Its frozen six-question displays remain byte-identical to the judged rollback. Independent corrected-target verification completed with three passes, seven questions and no findings/gaps, including real nested dispatch, mixed-source/fork recovery, actual saved-program traces and exact-base failures. Validators checked retained experiments instead of claiming to rerun them. This closes the correction/reconciliation gate, not a broad accuracy claim or operator approval.

The ancestry label 'question' was another overclaim: notifications and learning packets can occupy that position. A public regression demonstrated it; 'preceding input' now describes chronology without asserting causality.

## Learnings

- Source existence, source support, evidence displayed and evidence used are different. A structurally successful notebook lookup had unrelated sources. An agent attributed a loss to compaction even though its active summary still contained the checklist.
- Transcript byte size is a poor proxy for long-lived work. The initial size-biased audit was retained transparently and supplemented with compaction-depth sampling.
- A compaction boundary is not a storage collection boundary. Naive truncation loses live kept messages, settings, custom state, mail replay deduplication, citations and index continuity.
- The installed Pi loader can append a missing newline and migration can rewrite originals. Read-only research must parse JSONL directly. This hazard and its source evidence live in retention-investigation.md.
- Hot-memory bounds, compressed cold storage and finite total retention are separate promises. Lossless archiving alone cannot stop lifetime growth.
- Measure the actual tool over frozen source revisions and historical prefixes. A message-only reconstruction cannot evaluate newly searchable custom/summary sources, and a moving checkout confounds comparison.
- A green behavioral suite can coexist with worse retrieval quality. Keep full-entry relevance, labeled-episode recovery and displayed sufficiency distinct; a repeated premise can be relevant without being independent corroboration.
- Treat reflection as a concurrent writer through its final diff. A test-only report did not freeze later source/docs edits; rollback first refused a newly changed doc. Inspect and preserve those edits before reverting or freezing.
- git revert --no-commit stages its deletions. Re-adding a path already absent from the index fails; inspect the staged set and add only remaining existing edits rather than treating the failure as a missing deletion.

## Improvements and remaining decisions

The original research made no production change or archival operation. Authorized implementation retains extraction/addressing and visible-evidence fixes; the query/ranking/filter/page increment was withdrawn. Its legacy limitations remain explicit rather than hidden by a nominal feature-complete claim. The corrected-target review has settled; the isolated ranking/answer-context experiment is preparing held-out questions under experiment.md. That experiment requires frozen and prewritten held-out quality gains before any main landing. Keep cutoffs, labels and negative cases fixed, independently judge novel hits, and distinguish warm filesystem timing from cold startup/RSS.

Private gold and mappings remain outside the repository in documented temporary directories; those can disappear, so exact manual-label reproduction depends on retaining them privately or relabeling originals. Operator acceptance of completed review/experiment results, native-storage integration, fault testing, actual long-horizon behavior and finite total-state retention remain separate open obligations. Storage/archive implementation remains unapproved.
