Status: planning
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

Research complete. Read proposal.md first; evidence.md holds measurements/reproduction, independent-evaluation.md the labeled quality audit, and retention-investigation.md the consumer/protocol trace. Kofi owns synthesis. Saskia Tuilagi and Ciaran Gallo verified their saved reports, finished their advisory assignments and returned home. Private intermediate data remains outside the repository in documented temporary directories. The ledger stays planning pending operator approval; no production implementation is authorized.

## Outcome

Delivered a proposal from read-only measurements of 2,045 JSONL files (6.30 GB), current-function replay of 308 observed search calls in 22 long compacted histories, 31 independently checked recall pairs, and six bounded gold questions. Current precision@5 was 9/30, episode-relative recall@5 7/19 and displayed-answer sufficiency 2/6 on that purposive set. Issuer-only exclusion showed no quality gain. Proposed lossless Pi-owned hot/archive storage with explicit total-disk limits and ranked search fixes. Baseline: 86 focused tests in 10 files passed with one worker; seven search probes and three native retention counterexamples passed. No production source changes, original writes, daemon restart or migration. Proposal handed to Tadhg for the operator's approval; approval is not assumed.
