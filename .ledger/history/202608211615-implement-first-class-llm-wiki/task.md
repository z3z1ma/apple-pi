Status: done
Created: 2026-08-21
Updated: 2026-08-21

# Implement a first-class LLM wiki

## Intent

Give projects a first-class, durable LLM-maintained knowledge workbench that compounds source-backed context across sessions without duplicating apple-pi's execution, delegation, or integration runtimes.

## Outcome

Apple-pi ships one discoverable `llm-wiki` skill that guides agents through project-local `.wiki/` initialization, ingestion, querying, and linting. The workflow remains Markdown-first, source-aware, safe around untrusted content, and minimal enough to evolve with each project.

## Scope

- Add one packaged `llm-wiki` skill owning initialize, ingest, query, and lint workflows.
- Define the minimal project-local `.wiki/` shape and its preservation, provenance, mutation, and trust boundaries.
- Evaluate the skill through matched fresh-context no-skill and treatment scenarios.
- Update the closest package documentation, loader invariant, package validation, and third-party attribution required by the new public skill.
- Add supporting skill files only when an observed evaluation failure or named invariant requires one and the production skill directly consumes it.

## Non-goals

- A global wiki registry, database, vector store, graph service, or remote synchronization layer.
- Dedicated wiki extensions, Pi tools, commands, crawlers, extractors, or provider-specific integrations.
- Mandatory source snapshots, hashes, drift detection, fixed taxonomies, frontmatter, or artificial page/link quotas.
- Automatic Git policy changes, external publication, unrequested query filing, or unrequested lint fixes.

## Acceptance Criteria

- AC-001: The packaged `llm-wiki` skill is discoverable and owns initialize, ingest, query, and lint without a new runtime subsystem.
- AC-002: Initialization creates the uppercase canonical shape for an absent wiki; for an existing wiki it preserves content, creates only nonconflicting missing artifacts, and reports incompatible paths pending approval, while leaving Git policy untouched.
- AC-003: Ingest orients before writing, treats sources as untrusted data, integrates rather than mechanically proliferates pages, preserves attribution and uncertainty, keeps navigation accurate, and logs only completed knowledge mutations.
- AC-004: Query produces cited answers from the project wiki without mutation and offers durable filing separately.
- AC-005: Lint reports structural and semantic issues with evidence without mutation and offers bounded fixes separately.
- AC-006: Fresh-context no-skill controls and matched treatment scenarios record prompts, fixtures, inference/tool conditions, responses, and filesystem effects; treatment corrects an observed material failure without regressing correct behavior.
- AC-007: Documentation explains `.wiki`, its distinction from `.ledger`, workflow entry points, storage-policy ownership, package inclusion, and third-party inspiration.

## Constraints

- The operator approved the active specification at `.ledger/202608211615-implement-first-class-llm-wiki/specs/llm-wiki.md` on 2026-08-21.
- `.wiki/` is project-local and is the accumulated-knowledge counterpart to execution-oriented `.ledger/`.
- Canonical navigation and mutation-history files are uppercase `INDEX.md` and `LOG.md`.
- V1 owns initialize, ingest, query, and lint. Query and lint complete their read/report phase before any authorized mutation phase.
- The schema starts minimal and evolves locally. Local source retention is useful but is not mandatory archival policy.
- Prefer expressive, composable frontier-model judgment and existing Pi tools, `pi_exec`, typed agents, Research, and MCP boundaries over deterministic wiki machinery.
- Preserve unrelated uncommitted Ledger history artifacts and index changes.

## References

- `.ledger/202608211615-implement-first-class-llm-wiki/specs/llm-wiki.md`
- `.ledger/202608211615-implement-first-class-llm-wiki/research/reference-implementations.md`
- `.ledger/202608211615-implement-first-class-llm-wiki/decisions/project-local-wiki-boundary.md`
- `.ledger/202608211615-implement-first-class-llm-wiki/decisions/simple-local-source-retention.md`
- `.ledger/202608211615-implement-first-class-llm-wiki/plans/2026-08-21-llm-wiki.md`
- `.ledger/202608211615-implement-first-class-llm-wiki/evidence/2026-08-21-specification-review.md`
- `README.md`
- `docs/boundaries.md`
- `docs/development.md`
- `docs/exec.md`
- `docs/subagents.md`
- `skills/skill-authoring/SKILL.md`
