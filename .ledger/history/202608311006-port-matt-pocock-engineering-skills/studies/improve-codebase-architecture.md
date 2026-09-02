# `improve-codebase-architecture` fidelity study

Sources: `mattpocock/skills` at `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`

- `skills/engineering/improve-codebase-architecture/SKILL.md`
- `skills/engineering/improve-codebase-architecture/HTML-REPORT.md`
- `docs/engineering/improve-codebase-architecture.md`
- upstream `codebase-design`, `grilling`, and `domain-modeling` dependencies
- Apple Pi `codebase-design`, `interrogate-to-design`, `domain-modeling`, wiki, Explorer, and Designer contracts

Status: design decisions resolved; implementation awaiting approval

## Role in the workflow

`improve-codebase-architecture` is a human-only architecture survey, not a refactoring command. It scans a named area or recent code hot spots for **deepening opportunities**, renders candidates in one visual HTML report in the OS temp directory, stops for candidate selection, then interrogates the selected candidate until its design is settled. No production code changes during the run. The chosen decision re-enters the normal build flow through `to-spec`, `to-tickets`, and `implement`.

It differs from:

- `codebase-design`, which supplies the depth/seam vocabulary and interface-design methods for an already selected module;
- `diagnosing-bugs`, which investigates a concrete failure;
- `wayfinder`, which maps a whole multi-context decision effort; and
- `code-review`, which assesses a selected change rather than surveying architecture.

## Upstream doctrine to preserve

1. Keep `disable-model-invocation: true`.
2. The objective is testability and AI-navigability through **deep modules**, not generic cleanup.
3. Use the `codebase-design` vocabulary exactly: **module**, **interface**, **implementation**, **depth**, **deep**, **shallow**, **seam**, **adapter**, **leverage**, and **locality**. Do not drift into `component`, `service`, `API`, or `boundary` for those meanings.
4. Respect domain language and governing ADRs. Do not re-litigate an ADR unless observed friction is strong enough to justify explicitly reopening it.
5. Scope before scanning. Honor a user-named module, subsystem, pain point, or incoming specification. Otherwise inspect a substantial recent Git history and bias attention toward paths that repeatedly change. Widen only when history has no clear hot spot.
6. Explore organically rather than applying a rigid smell checklist. Look for concepts spread across many small modules, shallow interfaces, test-only function extraction without locality, seam leakage, coupled modules, and behavior that cannot be tested through the current interface.
7. Apply the **deletion test** to every candidate: deletion must concentrate complexity behind a smaller interface, not merely spread it among callers.
8. The survey produces one fresh timestamped HTML file outside the repository and no code changes.
9. Every candidate includes files/modules, concrete friction, a plain-English deepening, locality/leverage and test benefits, a visual before/after comparison, dependency category, and one strength badge: `Strong`, `Worth exploring`, or `Speculative`.
10. End with one **Top recommendation** and why it leads.
11. Do not propose detailed interfaces before the user chooses a candidate. After writing and opening the report, ask: **“Which of these would you like to explore?”** Then stop and wait.
12. Explore one selected candidate per conversation. Interrogate constraints, dependencies, the deepened module, what belongs behind the seam, and which tests survive. The result is a design decision, not a diff.
13. Keep durable domain language current as decisions crystallize. Offer an ADR only for a durable, load-bearing rejection or accepted trade-off that future explorers need; require approval before writing it.
14. Use `codebase-design`'s Design It Twice procedure when alternative interfaces need exploration.
15. Hand the settled decision to `to-spec`; do not jump directly into implementation.

## Exploration mapping

Read and apply the installed `codebase-design` skill and its progressive references before judging candidates. Read relevant `.wiki/` domain-language and architecture pages when they exist, using `wiki_references` when nearby context matters. Treat wiki pages as supporting context; repository documentation, tests, ADRs, and maintainer instructions retain authority.

Use one direct read-only Explorer session for the organic scan, with a very thorough brief containing:

- the user-named scope or Git-derived hot spots;
- relevant domain and ADR paths;
- the complete deep-module vocabulary and deletion test;
- the request for evidence-backed candidate locations rather than interface proposals; and
- the requirement to return concrete paths and friction to the root.

The root remains responsible for reading governing evidence, checking each candidate, applying the deletion test, assigning strength, and selecting the top recommendation. Flat scan work does not need Pi Exec.

## HTML report contract

Preserve the upstream report structure as a progressive reference under `references/html-report.md`:

- editorial stone/slate layout with generous whitespace;
- concise header and diagram legend, no throat-clearing introduction;
- one card per candidate;
- exact dependency-category tag (`in-process`, `local-substitutable`, `ports & adapters`, or `mock`);
- files, before/after centerpiece, one-sentence problem, one-sentence solution, short wins, optional ADR warning, and strength badge;
- diagram patterns selected for the actual structure: dependency/flow graph, hand-built boxes/arrows, layered cross-section, interface/implementation mass diagram, or call-graph collapse;
- one larger top-recommendation card; and
- exact architecture vocabulary throughout.

Resolve the OS temp directory from `$TMPDIR`, then `/tmp`, or `%TEMP%` on Windows. Write a fresh `<tmpdir>/architecture-review-<timestamp>.html`. Attempt to open it with the platform command; when opening is unavailable, report the absolute path without treating that as report failure.

The operator chose upstream's single-agent ownership: the root verifies the candidate facts and writes the temporary HTML report directly from the full report reference. Before presenting it, inspect the generated source for candidate completeness, unsupported claims, stale paths, and prohibited repository writes.

### External assets

The operator chose to preserve upstream's Tailwind and Mermaid CDN default. The report therefore needs network access when opened and inherits the documented offline, SRI, and locked-down-environment failure mode. Keep secrets, source bodies, transcript content, and other private bytes out of the report; summarize only the architecture evidence needed for the candidate cards. If CDN rendering is blocked, report that limitation and offer the documented inline CSS/SVG workaround rather than silently claiming the rendered report was verified.

## Candidate selection boundary

The report phase always stops after asking which candidate to explore. It does not silently continue with the top recommendation. An explicit “report only” invocation ends after the report and path are delivered.

After selection, continue in the same conversation and use the installed `interrogate-to-design` skill for the design-tree/frontier interview and bounded knowledge curation. Pi and the model can load and follow the named `SKILL.md`; this needs no model-callable Skill tool, invocation bridge, Pi Exec indirection, or duplicated full protocol.

Keep the architecture-specific frame in this skill: interrogate constraints, dependencies, the deepened module, what belongs behind the seam, and which tests survive. Ask the complete current frontier with recommendations, stop and wait after every round, and finish only when the frontier is empty and the operator confirms shared understanding. Use `codebase-design`'s Design It Twice procedure when alternative interfaces need exploration, and use `domain-modeling` for exact term and ADR discipline as needed.

## Durable design context

During the selected-candidate interview, invocation authorizes the same bounded knowledge curation as `interrogate-to-design`:

- update resolved terms in the relevant `.wiki/` domain-language page;
- integrate reusable architecture knowledge into the appropriate wiki page without turning it into the implementation specification;
- preserve provenance, uncertainty, and authority distinctions;
- offer an ADR only when the decision qualifies and write it only after explicit approval; and
- keep the task-specific build specification and tickets in their existing ledger/repository owners.

Run `wiki_lint` after wiki link or structural changes and repair only findings introduced by this mutation. No code, commit, publication, deployment, external tracker mutation, or implementation authority follows from the survey.

## Completion

After shared understanding is confirmed, report:

- the selected candidate and settled deepening decision;
- the report's absolute temporary path;
- durable wiki or approved ADR paths changed;
- unresolved research/prototype hand-offs; and
- that the next build step is `to-spec`.

Unselected candidates remain suggestions in the temporary report. Do not create tickets, tasks, ADRs, or backlog items for them automatically.

## Fidelity classification

### Preserved upstream

- Human-only periodic survey outside the build loop.
- Hot-spot-first YAGNI scope.
- Organic read-only exploration and deletion test.
- Exact deep-module vocabulary.
- Visual candidate cards, strength badges, dependency categories, and top recommendation.
- No interface proposal before selection.
- Stop-and-wait candidate choice.
- One-candidate interrogation, inline domain upkeep, qualified ADR offers, and Design It Twice.
- No production-code mutation and `to-spec` handoff.

### Platform mappings

- `CONTEXT.md` domain language maps to relevant `.wiki/` pages; repository ADRs remain authoritative.
- Upstream Explore maps to one direct read-only Explorer.
- Upstream Skill-tool calls map to plain instructions to use the installed `codebase-design`, `interrogate-to-design`, and `domain-modeling` skills. Pi and the model load their `SKILL.md` procedures directly; no bridge or duplication is needed.

### Preserved rendering choice

- Keep upstream's Tailwind and Mermaid CDN default, its mixed Mermaid/hand-built visual guidance, and its documented blocked-CDN fallback.

### Deliberate omissions

- No automatic refactor, ticket creation, backlog publication, tracker update, recurring schedule, stored architecture inventory, or Pi Exec graph.
- No automatic continuation from the top recommendation.

## Proposed package shape

- `skills/improve-codebase-architecture/SKILL.md`
- `skills/improve-codebase-architecture/references/html-report.md`
- Human-only loader visibility.
- README, provenance, adopted-boundary, loader, Pi Exec hidden-skill, and package inclusion reconciliation.
- Proportional loader/package checks; no prose behavior harness or runtime implementation.

## Resolved operator decisions

1. **Report assets** — preserve upstream's Tailwind and Mermaid CDN default. If those assets are blocked, report the limitation and offer the inline CSS/SVG workaround.
2. **Report owner** — preserve upstream's root ownership; do not add a Designer handoff.
3. **Post-selection composition** — continue in the same conversation with a small architecture-specific frame, while directing the agent to use the installed `interrogate-to-design`, `codebase-design`, and `domain-modeling` skills at the appropriate points. Pi's normal skill loading is sufficient; add no Skill-tool bridge or full duplicated protocol.
