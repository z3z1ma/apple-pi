Status: active
Created: 2026-08-21
Updated: 2026-08-21

# Keep local source retention simple and optional

## Context

The reference implementations commonly prescribe immutable snapshots, hashes, drift detection, and strict raw-source policy. Those mechanisms improve reproducibility but can turn a simple compounding knowledge workflow into a source-archival system with new maintenance, privacy, and enforcement obligations.

## Decision

`.wiki` may store ingested source information locally, normally under a raw/source area, but local retention is a useful convention rather than a mandatory archival contract.

The first implementation will not require content-addressed snapshots, drift detection, source synchronization, immutable-file enforcement, or a processing manifest merely to claim provenance. Derived wiki content is the primary project artifact. The workflow should retain enough source context or attribution to make its synthesis intelligible, while allowing teams to ignore raw material or the entire `.wiki/` directory according to their repository policy.

The governing design principle is KISS: preserve usefulness, expressivity, and composability, and rely on frontier model judgment where deterministic machinery has not earned its complexity.

## Authority and Provenance

The operator approved local retention but explicitly rejected making it mandatory or over-engineering snapshot/drift machinery. They noted that individual users in a large multiplayer repository may keep personal project-local `.wiki` directories ignored from Git, while other projects may keep synthesized content in the repository.

## Alternatives

### Mandatory immutable snapshots and hashes

This improves repeatability and source-change detection, but creates an archival and synchronization subsystem that is not required for the core knowledge-compilation behavior.

### References only

This minimizes duplication but unnecessarily prevents a user from retaining useful local source material.

## Consequences

- The schema distinguishes source attribution from source archival.
- The skill can ingest local files, fetched content, or pasted material without requiring a manifest or hash ledger.
- Repository owners decide whether `.wiki`, raw material, only synthesized pages, or none of it is committed.
- A later deterministic source-integrity component requires observed failures and a new product contract.

## Limits and Revisit Conditions

Revisit if real usage shows harmful duplicate ingestion, source drift, or untraceable claims that cannot be corrected with simpler citation and review guidance.

## Related Records

- `.ledger/202608211615-implement-first-class-llm-wiki/task.md`
- `.ledger/202608211615-implement-first-class-llm-wiki/decisions/project-local-wiki-boundary.md`
- `.ledger/202608211615-implement-first-class-llm-wiki/research/reference-implementations.md`
