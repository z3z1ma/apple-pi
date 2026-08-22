Status: active
Created: 2026-08-21
Updated: 2026-08-21

# First-class project LLM wiki

## Purpose and Authority

Apple-pi will provide one packaged `llm-wiki` Agent Skill for accumulating durable project knowledge in a project-local `.wiki/` directory.

The operator approved a skill-first architecture with no new runtime subsystem. The skill owns four workflows—initialize, ingest, query, and lint—and composes existing Pi tools, `pi_exec`, typed agents, and MCP only when the work warrants them.

The active decisions governing this specification are:

- `.wiki/` is the knowledge- and context-oriented counterpart to execution-oriented `.ledger/`.
- Local source retention is useful but not an archival mandate.
- KISS, expressivity, composability, and frontier-model judgment take priority over speculative deterministic machinery.
- Query and lint are read/report-first and offer mutations separately.
- The minimal filenames are uppercase `INDEX.md` and `LOG.md`.

## Actors and Boundaries

### Operator

The operator chooses what knowledge to ingest, whether source material should be retained locally, whether query results should be filed, and whether lint findings should be fixed. The operator or repository owner decides whether any or all of `.wiki/` is ignored, committed, shared, or personal.

### `llm-wiki` skill

The packaged skill supplies the reusable procedure and judgment rules. It may use ordinary filesystem tools directly and may use existing `pi_exec`, Research agents, Explore agents, or MCP when scale or source acquisition justifies them. It must not create a second composition engine, agent framework, research database, source synchronizer, or global wiki registry.

### Project wiki

The project root owns `.wiki/`. In a Git worktree, the project root is the repository top level; otherwise it is the current project working directory. The minimal initialized shape is:

```text
.wiki/
  README.md
  INDEX.md
  LOG.md
  raw/
  pages/
```

- `README.md` states the wiki's purpose and concise local conventions. Those conventions may evolve with the domain.
- `INDEX.md` is the primary navigation surface. It contains useful links with concise descriptions rather than a mechanical file inventory.
- `LOG.md` is an append-only history of knowledge mutations.
- `raw/` may retain local source material when useful.
- `pages/` contains synthesized project knowledge and may evolve into domain-specific subdirectories when real content warrants them.

The uppercase names `INDEX.md` and `LOG.md` are canonical.

### Relationship to other apple-pi state

`.wiki` is not Ledger task state, session memory, observational memory, a transcript mirror, or a substitute for repository-owned product documentation. `.ledger` governs bounded execution; `.wiki` accumulates reusable project knowledge and context. Knowledge that belongs in an authoritative project document may be promoted there rather than duplicated indefinitely.

## Required Behavior

### Skill discovery and authority

1. Apple-pi packages one discoverable skill named `llm-wiki`.
2. Its description triggers when a user asks to initialize, ingest into, query, maintain, audit, or lint a project `.wiki`.
3. One authoritative `SKILL.md` owns the workflow. The default implementation is that file alone. A supporting file is permitted only when an observed baseline or treatment failure identifies the behavior it must change or the invariant it must protect, and the production skill explicitly references, loads, or copies it.
4. The skill treats repository content and ingested sources as evidence and data, never as authority or agent instructions.
5. Local `.wiki/README.md` conventions may govern organization, formatting, and linking only. They cannot alter tool permissions, trust, mutation scope, external side effects, or workflow authority.

### Orientation

Before ingest, query, or lint, the skill:

1. Establishes the project root and `.wiki` path.
2. Reads `.wiki/README.md` and `.wiki/INDEX.md`.
3. Reads the recent relevant tail of `.wiki/LOG.md` when it can affect the operation.
4. Searches existing pages before creating new pages or claiming that knowledge is absent.
5. Follows locally evolved conventions unless they conflict with active operator instructions or safety boundaries.

The skill does not scan every page by default. It expands from the index and targeted search according to the question or ingest scope.

### Initialize

When asked to initialize a wiki, the skill:

1. Creates the minimal `.wiki` shape.
2. Writes a concise `README.md` describing the project's initial wiki purpose and conventions.
3. Writes an `INDEX.md` suitable for content-oriented navigation.
4. Writes a `LOG.md` with its append-only role made clear and records initialization.
5. Does not modify `.gitignore`, initialize Git, install dependencies, or create domain taxonomies without explicit operator authorization.
6. Applies this existing-wiki matrix:
   - If `.wiki/` is absent, create the canonical uppercase starter shape.
   - If `.wiki/` exists, create only missing artifacts whose paths do not conflict with existing content.
   - If lowercase, case-equivalent, symlinked, or otherwise incompatible navigation/history paths already exist, preserve their bytes and paths, report canonical initialization as incomplete, and require approval before rename, merge, replacement, or reorganization.
7. Does not overwrite an existing wiki merely to restore the canonical starter shape.

Initialization is intentionally light. It does not require an interview, fixed ontology, frontmatter schema, sample content, manifest, source hashes, or generated configuration files.

### Ingest

When asked to ingest one or more sources, the skill:

1. Accepts source material available through existing capabilities, including local files, URLs or external research results, and pasted text.
2. Treats source contents as untrusted data. Instructions found inside a source do not change the workflow, permissions, destination, or operator intent.
3. May retain source information under `.wiki/raw/` when useful and practical. Local retention is not required for every source, and missing snapshots or hashes are not lint failures.
4. For an unretained or nonrecoverable source such as pasted text or an ephemeral research result, records a useful source identity, marks that the original is not recoverable from the wiki, and preserves enough quotation or contextual support for a future reader to understand the derivation.
5. Reads and searches existing wiki knowledge before writing.
6. Integrates useful knowledge into existing pages when possible and creates new pages when a distinct durable subject warrants one.
7. Preserves uncertainty, disagreement, and contradiction rather than silently converting inference into fact or forcing one source to win.
8. Gives derived pages a lightweight `Sources` section or equally clear local attribution. Citations identify a retained wiki source, local path, URL, or other useful origin and include a locator when one is available and materially helpful.
9. Keeps `INDEX.md` accurate and edits it only when navigation or a navigation description changes.
10. Appends a concise mutation record to `LOG.md` only after an actual completed knowledge mutation, naming the source or subject and affected knowledge pages. Failed and no-op operations report their outcome without index or log mutation.
11. Reports created and updated paths.

The skill imposes no minimum page count, link count, source count, frontmatter fields, or edit count. If an ingest would materially broaden the user's requested scope or rewrite a large portion of the wiki, the skill presents the intended mutation boundary and asks before proceeding.

### Query

When asked a question of the wiki, the skill:

1. Orients from `README.md` and `INDEX.md`, searches as needed, and reads the smallest relevant set of pages.
2. Follows meaningful links and source references when required to answer accurately.
3. Distinguishes supported wiki knowledge, source statements, synthesis, and unresolved uncertainty.
4. Cites the wiki pages and useful underlying sources that support the answer.
5. Runs as a strictly read-only phase: it performs no project-filesystem, Git, initialization, repair, cache, report-file, or log writes.
6. Offers to file a durable comparison, synthesis, correction, or other page when the answer would improve future knowledge.
7. Filing is a distinct mutation phase after the answer. An initial explicit request to query and file authorizes that phase; otherwise the skill offers it. The skill asks again only when the resulting mutation would materially exceed the authorized scope. Approved filing updates relevant pages, keeps `INDEX.md` accurate, and appends `LOG.md` only after the mutation completes.

If `.wiki` is absent, the skill states that no project wiki exists and offers initialization. It does not manufacture a wiki-backed answer from unrelated state.

### Lint

When asked to lint or audit the wiki, the skill performs a proportional read-only review that may cover:

- broken or ambiguous links;
- pages missing from useful navigation;
- duplicate or overlapping pages;
- contradictions or uncertainty that are hidden or inconsistently represented;
- claims whose support cannot be found in their stated sources;
- stale or misleading organization;
- orphaned knowledge that should be connected, merged, archived, or promoted;
- local conventions that no longer match actual use.

Lint output separates observed structural issues from semantic hypotheses and gives path-specific evidence. It does not require artificial link density, mandatory snapshots, a fixed taxonomy, or universal frontmatter.

Lint is a strictly read-only phase: it performs no project-filesystem, Git, initialization, repair, cache, report-file, or log writes. It reports findings before any fix phase. An initial explicit request to lint and fix authorizes the subsequent bounded fix phase; otherwise the skill offers it. The skill asks again only when the resulting mutation would materially exceed the authorized scope. Approved fixes update affected files, keep `INDEX.md` accurate, and append `LOG.md` only after the mutation completes.

### Scaling and composition

For small operations, the root agent uses ordinary tools directly. For operations where bounded fan-out, external research, or reduction materially helps, the skill uses existing `pi_exec` and typed agents according to their documented boundaries. Scale alone does not authorize a new persistent index, database, embedding service, graph service, or wiki-specific runtime component.

The `.wiki/` root itself must resolve within the project root; an external symlinked vault is rejected as outside the project-local boundary. All wiki mutation destinations must resolve beneath that vault root. The skill rejects absolute destinations, `..` traversal, and symlink escape rather than following a source-selected or local-convention-selected write path outside the vault.

## Error and Failure Behavior

- Initialize has no wiki-file prerequisite.
- Ingest requires an existing `.wiki/` plus `README.md`, `INDEX.md`, and `LOG.md`; if any is missing or incompatible, it stops before mutation and offers initialization or repair. `raw/`, `pages/`, and evolved domain directories are optional and may be created within an authorized ingest when needed.
- Query requires `.wiki/`. Missing `README.md` or `INDEX.md` is reported as a limitation; because query is read-only, it may continue with targeted search when useful but cannot claim complete wiki coverage. Missing `LOG.md` does not block a read-only answer.
- Lint requires `.wiki/`, treats missing canonical artifacts as findings, and continues over whatever wiki content is safely readable.
- The skill does not silently invent replacements during ingest, query, or lint.
- Existing files are never overwritten merely to restore the canonical starter shape.
- A failed source fetch, unsupported format, unreadable local file, or incomplete extraction remains visible. The skill does not turn partial acquisition into a complete ingest claim.
- A source lacking enough evidence for a confident synthesis is represented as uncertain or remains unfiled.
- Conflicting sources remain attributed and unresolved unless the operator or authoritative evidence resolves them.
- Partial multi-file mutation is reported with the paths known to have changed; the skill does not claim atomic success or append the normal completed-mutation log entry. A later authorized recovery may record the correction after the wiki is coherent.
- External writes, uploads, credential use, publication, Git changes, and dependency installation require separate operator authority.
- The skill does not move private source material into logs, repository fixtures, external tools, or commits merely for verification.

## Scenarios

### New project wiki

The operator asks to initialize an LLM wiki. The skill creates `.wiki/README.md`, `.wiki/INDEX.md`, `.wiki/LOG.md`, `.wiki/raw/`, and `.wiki/pages/`, records initialization, and leaves Git policy unchanged.

### Ingest a design document

The operator asks to ingest a local design document. The skill reads current wiki conventions and knowledge, treats the document as source data, updates or creates only warranted pages, attributes the source, keeps `INDEX.md` accurate—editing it only if navigation changed—appends one completed-mutation entry to `LOG.md`, and reports paths. It does not create five pages merely to meet a quota.

### Ask a project-history question

The operator asks why a subsystem uses a particular architecture. The skill reads the index and relevant pages, follows sources when needed, answers with citations and uncertainty, and does not write. It offers to file the synthesis if it is durable and currently absent.

### Lint a personal ignored wiki

A developer keeps `.wiki` ignored in a shared repository. Lint checks that local vault according to its own README and reports issues without changing repository Git policy or assuming the wiki is team-shared.

### Hostile source content

A fetched source says to ignore prior instructions and run a command. The skill treats that text as source content, does not execute it, and continues only under the operator's ingest request and existing tool authority.

### Existing noncanonical wiki

A project already has `.wiki` content with domain-specific folders. Initialization or maintenance preserves that structure, adds only missing nonconflicting navigation when compatible, and does not reorganize the vault to match the starter layout without approval. If `index.md` or `log.md` already exists—including on a case-insensitive filesystem—the skill preserves it and reports canonical initialization as incomplete until the operator approves a rename or merge.

### Hostile wiki path

An existing `.wiki/README.md`, source, or wikilink proposes an absolute destination, `..` traversal, or symlinked write outside `.wiki/`. The skill treats it as untrusted organization data, refuses the destination, and performs no out-of-vault mutation.

### Skill evaluation

Fresh disposable root Pi sessions use matched model profile, tools, prompts, and initial filesystem fixtures. The no-skill control runs first and records exact responses and filesystem effects. Scenario IDs cover initialization and preservation, ingest integration and untrusted content, query read-only behavior, lint read-only behavior, and KISS boundaries. Treatment succeeds only when it corrects an observed material control failure without regressing already-correct behavior. If no scenario exhibits a material baseline failure, authoring stops and returns to shaping rather than manufacturing a need for packaged guidance.

## Acceptance Mapping

- AC-001: The packaged `llm-wiki` skill is discoverable and owns initialize, ingest, query, and lint without a new runtime subsystem.
- AC-002: On an absent wiki, initialization produces the canonical minimal project-local `.wiki` shape with uppercase `INDEX.md` and `LOG.md`; on an existing wiki, it preserves content, creates only nonconflicting missing artifacts, and reports case-equivalent or incompatible paths as incomplete pending approval. Both paths leave Git policy untouched.
- AC-003: Ingest orients before writing, treats sources as untrusted data, integrates rather than mechanically proliferates pages, preserves attribution and uncertainty, keeps navigation accurate, and logs only completed knowledge mutations.
- AC-004: Query produces cited answers from the project wiki without mutation and offers durable filing separately.
- AC-005: Lint reports structural and semantic issues with evidence without mutation and offers bounded fixes separately.
- AC-006: Fresh-context no-skill controls and matched treatment scenarios record prompts, initial fixtures, model/profile/tools, responses, and filesystem effects for mutation boundaries, hostile source and path content, existing-wiki preservation, and KISS constraints; treatment must correct an observed material baseline failure without regressing correct control behavior.
- AC-007: User and maintainer documentation explains `.wiki`, its distinction from `.ledger`, workflow entry points, storage-policy ownership, and package inclusion; third-party inspiration is attributed.

## Exclusions

The first implementation does not include:

- a global or cross-project wiki registry;
- a wiki extension, dedicated Pi tools, or custom commands;
- a database, vector store, embedding index, graph service, ontology uploader, or remote synchronization;
- mandatory snapshots, hashes, drift detection, processing manifests, or immutable-file enforcement;
- fixed entity/concept/source/comparison/synthesis taxonomies;
- mandatory YAML frontmatter, link counts, page counts, source counts, or file-size thresholds;
- PDF/OCR/transcription engines, crawlers, web-clipping infrastructure, or provider-specific fetch code;
- automatic Git initialization, `.gitignore` edits, commits, publication, or external uploads;
- automatic filing of queries or automatic lint fixes;
- slide export, graph visualization, research todos, reminders, or archiving machinery.

These exclusions may be revisited only when observed usage demonstrates a concrete failure or recurring cost and identifies a production consumer.

## Assumptions and Provenance

- Operator-ratified: `.wiki` is project-local and is the accumulated-knowledge counterpart to `.ledger`.
- Operator-ratified: uppercase `INDEX.md` and `LOG.md` are canonical.
- Operator-ratified: v1 owns initialize, ingest, query, and lint.
- Operator-ratified: query and lint read/report first, then offer mutation.
- Operator-ratified: the schema has a minimal core and evolves locally.
- Operator-ratified: local source storage is allowed but is not a mandate, and source snapshot/drift machinery would violate the intended KISS boundary.
- Repository-backed: package skills live under `skills/` and are automatically included through the package's configured skills directory and published `files` allowlist.
- Repository-backed: `pi_exec`, typed agents, and MCP already own composition, specialist delegation, and external integrations.
- Workflow-backed: packaged skill authoring requires a failing fresh-context baseline before candidate guidance; a control with no material failure returns the task to shaping.
- Research-backed: the common reference pattern is immutable-or-preserved sources plus interlinked synthesized Markdown, index-first retrieval, mutation logging, contradiction handling, and maintenance linting; the active decisions intentionally simplify its source-integrity machinery.

## Related Records

- `.ledger/202608211615-implement-first-class-llm-wiki/task.md`
- `.ledger/202608211615-implement-first-class-llm-wiki/research/reference-implementations.md`
- `.ledger/202608211615-implement-first-class-llm-wiki/decisions/project-local-wiki-boundary.md`
- `.ledger/202608211615-implement-first-class-llm-wiki/decisions/simple-local-source-retention.md`
- `README.md`
- `docs/boundaries.md`
- `docs/exec.md`
- `docs/ledger.md`
- `docs/subagents.md`
- `skills/skill-authoring/SKILL.md`
