Status: open
Created: 2026-08-31
Updated: 2026-08-31

# Refine the LLM wiki with prompt and graph tools

## Intent

Refine Apple Pi's project-local `.wiki/` into a lightweight knowledge workbench with compact ambient guidance, deterministic Obsidian-link integrity checks, cheap graph-neighborhood retrieval, and progressively disclosed maintenance procedures.

## Current State

The approved wiki workbench is implemented and validated. The root extension, ordinary child sessions (including the public read-only roles), and Pi Exec workers receive the compact prompt and read-only tools; the pair sidecar and internal `/btw` child remain excluded. The graph derives from Markdown on demand, enforces non-symlink boundaries, and handles aliases, heading fragments, same-page headings, Markdown page embeds, attachments, frontmatter, and common code-example contexts.

The exact wiki-only staged snapshot passes package loading independently of the concurrent engineering-skill redesign. That broader catalog remains unstaged and owned by its own task.

Accepted decisions:

- `.wiki/` remains project-local reusable LLM knowledge, distinct from task-local `.ledger/` and authoritative repository documentation.
- A compact wiki prompt and two read-only tools load in the root, ordinary child sessions, and Pi Exec workers, matching ledger distribution. They do not load in the pair sidecar or internal `/btw` child.
- A page slug is its Markdown filename stem. Slug identity and link resolution are case-insensitive, and slugs must be unique across the entire wiki regardless of nesting.
- The deterministic graph covers Obsidian page links, including aliases and heading fragments, but not ordinary Markdown links or non-Markdown attachments.
- `wiki_lint` validates graph integrity. `wiki_references` traverses inbound, outbound, or both directions to depth one or two.
- One discoverable `llm-wiki` skill stays small and routes to focused reference procedures.

## Acceptance Criteria

- The wiki extension appends one idempotent, compact workbench prompt and exposes only `wiki_lint` and `wiki_references`.
- `wiki_lint` reports duplicate case-insensitive filename-stem slugs, unresolved or ambiguous Obsidian page links, missing referenced Markdown headings, and unsafe paths with path and line evidence, without mutation.
- `wiki_references` resolves a slug or `.wiki`-relative Markdown path and returns directed first- or second-degree inbound, outbound, or bidirectional neighborhoods without mutation.
- Graph operations remain inside the project-local non-symlink `.wiki/` boundary, ignore ordinary Markdown links and code examples, and visibly truncate oversized output using Pi's standard limits.
- Root, ordinary-child, and worker distribution is covered by tests; the pair and internal `/btw` remain unchanged.
- `llm-wiki` uses progressive disclosure for initialize, ingest, query, and maintenance procedures, and its guidance uses the deterministic tools rather than recreating their work procedurally.
- Package, README, and product documentation describe the shipped extension, tools, slug/link convention, and authority boundary.

## Outcome

Implemented the compact wiki extension, deterministic `wiki_lint` and `wiki_references` tools, routed `llm-wiki` procedures, root/child/worker distribution, package integration, documentation, and behavioral coverage. The exact staged snapshot passes formatting, lint, type checking, 749 unit tests, package loading, package dry run, 112 offline pair tests, and diff checks.

## Related Work

- `.ledger/history/202608211615-implement-first-class-llm-wiki/` — completed skill-only v1, whose no-extension boundary this task intentionally revises.
- `.ledger/202608311006-port-matt-pocock-engineering-skills/` — engineering-skill redesign paused until the wiki substrate is settled.
