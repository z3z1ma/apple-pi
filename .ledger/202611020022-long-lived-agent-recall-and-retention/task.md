Status: in-progress
Created: 2026-11-02
Updated: 2026-11-02

# Measure long-lived agent recall and design transcript retention

## Intent

Persistent people need useful recall across weeks without unbounded hot transcripts and indexes. Assess current behavior on real histories, propose a safe archival design, and rank improvements to agent-facing search. Production changes require operator approval of the proposal.

## Decision and rival explanations

The decision is which recall improvements and retention model to implement first. Competing explanations are poor lexical retrieval, poor query formulation/navigation, missing evidence in searchable sources, and excessive storage/loading overhead. Measurements must separate these rather than treating a non-empty search result as success.

## Acceptance criteria

- Inventory real JSONL size, age, compaction, notebook and search use without writing to originals.
- Measure actual historical recall questions at their historical cutoff, with sufficient-evidence labels and explicit sampling limitations; separate topical retrieval from known-id navigation.
- Exercise production search on long histories, report latency and failure mechanisms, and compare any prototype on identical work.
- Trace Pi persistence and all material apple-pi transcript/index consumers; specify hot/archive contents, access, migration, atomicity and rollback.
- Deliver a proposal with evidence, ranked improvements, uncertainties, and approval decisions. Private transcripts, questions and excerpts stay outside the repository and mail; aggregate measurements and scripts may be committed.

## Current State

Research is complete. Approved extraction/addressing/presentation fixes remain on main after rollback `25c1d229` and review corrections `0843bfd3`. The query/ranking increment was withdrawn after evidence-recovery and display-sufficiency losses (Tadhg decision 7652). Corrected-source replay preserves all six rollback displays byte-for-byte: relevant 10/30 versus baseline 9/30; evidence hits 5/6, episode recall 7/19 and sufficient displays 2/6 unchanged. These are reused judgments under verified equivalence, not fresh observations.

Retained-source review found five defects and one end-to-end reconciliation gap. The corrections have nine red/green public cases, including actual native nested dispatch; 101 focused tests in 15 files pass. Independent verification and reconciliation completed in `review-60642218-ae89-4998-8b20-d76bcc523d4f`: 3/3 passes, 7/7 questions, zero findings or coverage gaps. The five earlier findings are recorded fixed using this new-target evidence; the old artifact's incomplete history remains intact. This is bounded correction verification, not operator approval or broad recall accuracy. Tadhg decision 7659 then authorizes an isolated ranking/answer-context experiment, with no main landing before gains on frozen and prewritten held-out questions. Delphine implemented the initial increments; Kofi owns measurement, judgments, rollback, corrections and synthesis. Runtime/schema work belongs to Tadhg/Fiona and remains untouched. No storage/archive prototype is approved; eventual cloud backup is deferred.

Read proposal.md first; evidence.md holds the original measurements/reproduction, independent-evaluation.md the labeled audit, and retention-investigation.md the deferred storage trace. Private data remains outside the repository. Original research findings stay historical evidence rather than being rewritten to match the new code.

## Approved implementation acceptance

- Supported custom mail, compaction summaries and modern array-edit bodies are discoverable without renumbering existing message ordinals.
- Exact entry/call/file recovery remains scoped and source-identifiable; index zero works.
- Search exposes stable provenance and evidence-labelled context. Preceding input is chronology, not an asserted originating question. Legacy query/ranking/discovery limits remain after the later increment was withdrawn.
- Measure frozen six-question results before/after, judging novel hits independently and preserving regressions/negative results; episode-relative recall remains distinct from complete-transcript recall.
- Commit verified increments by explicit owned paths; focused tests only with --maxWorkers=1. No archive/storage/index engine or runtime/schema changes.

## Implementation and experiment gates

Read implementation.md for exact revisions, all staged measurements, the withdrawn result and review state. Retained fixes must preserve baseline metrics. After their fresh review settles, freeze held-out questions/cutoffs/labels and the ranking success criteria before inspecting candidate results. Experimental code stays in an isolated branch/worktree; no main landing before beating baseline on both sets. Preserve negative outcomes and keep source availability, full-entry relevance, displayed sufficiency and downstream use distinct.

## Original research outcome

Delivered a proposal from read-only measurements of 2,045 JSONL files (6.30 GB), current-function replay of 308 observed search calls in 22 long compacted histories, 31 independently checked recall pairs, and six bounded gold questions. Current precision@5 was 9/30, episode-relative recall@5 7/19 and displayed-answer sufficiency 2/6 on that purposive set. Issuer-only exclusion showed no quality gain. Proposed lossless Pi-owned hot/archive storage with explicit total-disk limits and ranked search fixes. Baseline: 86 focused tests in 10 files passed with one worker; seven search probes and three native retention counterexamples passed. No production source changes, original writes, daemon restart or migration. Proposal handed to Tadhg for the operator's approval; approval is not assumed.
