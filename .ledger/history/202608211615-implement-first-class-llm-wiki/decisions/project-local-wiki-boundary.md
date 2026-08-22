Status: active
Created: 2026-08-21
Updated: 2026-08-21

# Use a project-local `.wiki` knowledge workbench

## Context

The LLM wiki needs a durable ownership and trust boundary. The reference implementations use local Markdown vaults, while apple-pi already uses project-local `.ledger` bundles for execution authority and operational memory.

## Decision

The first-class LLM wiki defaults to a project-local `.wiki/` directory.

`.wiki` is the knowledge- and context-oriented counterpart to `.ledger`: `.ledger` owns execution intent, decisions, progress, evidence, and closure for bounded work; `.wiki` accumulates durable subject knowledge and context across work. Neither substitutes for the other.

## Authority and Provenance

The operator selected a “project local vault in a directory called `.wiki` reflecting the simplicity of `.ledger`” and clarified that Ledger is the execution-oriented operational equivalent while Wiki focuses on accumulated knowledge and context.

## Alternatives

### User-global vault

A single personal vault would improve cross-project retrieval, but it would mix trust domains and require global discovery, routing, privacy, concurrency, and identity policy.

### Support project-local and global vaults equally in v1

An explicit-path abstraction could support both, but would broaden configuration and validation before the local workflow is proven.

## Consequences

- The repository root gives `.wiki` a clear discovery boundary.
- The skill can orient by reading `.wiki` without introducing a global registry or database.
- Wiki storage and Git policy remain a repository-owner choice rather than an automatic package action.
- Cross-project knowledge sharing is deferred unless later evidence justifies a separate contract.
- Documentation must clearly distinguish task execution records from accumulated knowledge artifacts.

## Limits and Revisit Conditions

Revisit if real usage demonstrates a recurring need for cross-project retrieval that cannot be served by explicit source links, ordinary repositories, or separate project-local wikis.

## Related Records

- `.ledger/202608211615-implement-first-class-llm-wiki/task.md`
- `.ledger/202608211615-implement-first-class-llm-wiki/research/reference-implementations.md`
- `docs/ledger.md`
