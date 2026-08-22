Status: done
Created: 2026-08-21
Updated: 2026-08-21

# LLM wiki reference implementations

## Question

Which behaviors from the four supplied LLM-wiki implementations should govern an apple-pi design, and which supporting machinery is justified by a real production consumer?

## Motivation

The requested skill is architectural: it may create durable knowledge artifacts, invoke research and composition tools, and introduce packaged scripts or components. The design needs evidence about the reference systems before product semantics are chosen.

## Sources and Methods

Accessed 2026-08-21. Repositories were shallow-cloned into a temporary directory, and the requested paths were read in full by independent read-only Research agents. The original gist was fetched from its raw URL and read in full.

- Alireza Rezvani, `claude-skills/engineering/llm-wiki`, revision `98180dafc4f0bc9d629bd479fc6107674cfb3cf8`: <https://github.com/alirezarezvani/claude-skills/tree/98180dafc4f0bc9d629bd479fc6107674cfb3cf8/engineering/llm-wiki>
- NousResearch Hermes Agent, `skills/research/llm-wiki/SKILL.md`, revision `b6bcb3e791c673e63974029bbab40cc9326803ff`: <https://github.com/NousResearch/hermes-agent/blob/b6bcb3e791c673e63974029bbab40cc9326803ff/skills/research/llm-wiki/SKILL.md>
- InfraNodus skills, `skill-llm-wiki`, revision `5d5bf8f47963aff6d295fe3f9b742af947d00458`: <https://github.com/infranodus/skills/tree/5d5bf8f47963aff6d295fe3f9b742af947d00458/skill-llm-wiki>
- Andrej Karpathy, “LLM Wiki” gist, raw content current at access time: <https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>

The comprehensive implementation review covered its skill, commands, agent prompts, references, templates, example vault, expected outputs, and Python scripts. The InfraNodus review covered both the skill and its uploader. Findings below separate observed common behavior from design recommendations.

## Findings

### Shared durable idea

All four sources converge on knowledge compilation rather than query-time-only retrieval:

1. Humans choose sources and direct inquiry.
2. Raw source material remains separate from agent-maintained synthesis.
3. The agent incrementally maintains linked Markdown pages rather than producing isolated summaries.
4. An index provides index-first orientation and bounded retrieval.
5. A chronological log records ingest, query, and maintenance operations.
6. Ingest updates existing concepts/entities/syntheses, records contradictions, and may affect several pages.
7. Query answers cite wiki pages and can be promoted back into durable comparison or synthesis pages.
8. Periodic linting checks links, orphans, stale claims, contradictions, schema drift, and research gaps.

Karpathy's original contribution is the smallest statement of this model: immutable raw sources plus a persistent, inspectable, versioned synthesis layer. The later implementations mostly elaborate schema, tools, and maintenance policy.

### Strongest reusable refinements

- Mandatory preflight orientation: read the local schema, index, and recent log before mutation.
- Source-centered provenance: preserve source captures or stable source identities, and connect derived claims back to them.
- Explicit uncertainty and contradiction representation instead of silently choosing a winner.
- Human confirmation before broad multi-page ingest or externally visible side effects.
- Separate deterministic maintenance from model judgment: indexing, search, link checks, source hashing, and structural lint can be executable; semantic synthesis and contradiction analysis remain agent work.
- Separate acquisition from processing so retrieval failures, retries, privacy choices, and synthesis can have distinct boundaries.
- Batch source discovery and navigation updates when processing multiple sources, without weakening the audit trail.
- InfraNodus's curated-versus-generated ownership distinction is useful in principle, but its remote graph integration is product-specific rather than core LLM-wiki behavior.

### Problems not to inherit

- Workflow duplication across skill, commands, agent definitions, loader files, and references creates immediate drift.
- Artificial edit-count rules such as requiring every ingest to touch five pages or every page to have two links encourage low-value artifacts.
- Naive YAML parsing, filename-stem identity, and basename-only link resolution create collisions and silent ambiguity.
- Prose-only raw-directory and immutability rules are not enforcement.
- Broad write/Bash permissions and untrusted source content create prompt-injection and path-traversal risk.
- Multi-file updates are non-transactional; interrupted or concurrent runs can leave pages, index, and log inconsistent.
- Hash checks establish byte identity, not factual quality. None of the references fully specifies source authority, corroboration, extraction-quality checks, claim-level locators, retractions, or adjudication of conflicts.
- Automatic remote graph uploads add credential discovery, cloud disclosure, partial-upload duplication, rate-limit, and remote-state risks. They are not justified for a local-first v1.
- Generated fixtures or expected-output copies without an executable production consumer are not meaningful verification.

### Apple-pi fit

Repository authority already establishes:

- Packaged skills are procedural guidance discovered from `skills/`.
- `pi_exec` is the single bounded composition runtime for fetch, local tools, MCP, and model workers.
- MCP owns external integration protocol and authentication.
- Typed `Research` agents are external research specialists, while local discovery belongs to `Explore`.
- Ledger is task authority and execution memory, not a global product wiki.
- Supporting code must have a real production consumer and observable consequence.

Therefore the wiki should be a distinct user/project knowledge artifact, not stored inside `.ledger`, observational memory, session JSONL, or a new hidden application database. A first-class skill can own the workflow and invoke existing Pi tools. Supporting deterministic utilities are justified only for invariants that model prose cannot reliably enforce, such as containment, source identity, index/link integrity, and atomic updates.

## Conclusions

The recommended starting point is a local-first, repository- or directory-scoped Markdown wiki with an explicit local schema, separate source and derived layers, stable source provenance, index-first query, explicit contradiction/uncertainty handling, approval-gated multi-page mutation, and report-only structural/semantic linting by default.

The design should keep one authoritative workflow in the packaged skill and use focused references or scripts only where they remove real ambiguity or enforce durable invariants. It should use existing `pi_exec`, research agents, and MCP rather than create a parallel crawler, agent framework, database, graph service, or composition engine.

The largest unresolved product choice is where a wiki lives and how its source material is acquired: a project-owned local vault, a user-global vault, or both. That choice affects trust, discovery, portability, privacy, Git behavior, and the need for runtime support.

## Limits

- The Karpathy gist revision could not be pinned because GitHub's gist API returned a gateway error; the raw content was captured at access time.
- The reviews established source behavior by inspection, not by executing third-party scripts or external services.
- InfraNodus server behavior, Obsidian integrations, PDF extraction quality, and large-vault performance were not independently tested.
- Recommendations are architectural inferences constrained by apple-pi's current documented boundaries; the operator still owns product semantics.

## Related Records

- `.ledger/202608211615-implement-first-class-llm-wiki/task.md`
- `README.md`
- `docs/boundaries.md`
- `docs/exec.md`
- `docs/subagents.md`
- `skills/skill-authoring/SKILL.md`
