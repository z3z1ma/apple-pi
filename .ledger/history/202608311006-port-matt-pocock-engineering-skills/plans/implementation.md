Status: superseded
Created: 2026-08-31
Updated: 2026-08-31

# Matt Pocock engineering-skill port

This implementation plan was superseded after the first port failed operator convergence. It remains as a record of the rejected approach, not as an active or completed design.

## Goal

Replace the current Superpowers-derived workflow skill layer with one coherent Apple Pi adaptation of Matt Pocock's engineering skills at commit `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`.

Apple Pi retains its own execution, authority, continuity, review, verification, and integration primitives. Matt-derived task artifacts live freely inside the active `.ledger/<task>/` bundle. `grill-with-docs` and active domain modeling write LLM-derived context as Markdown under `.wiki/` using ordinary file tools and the wiki's local organization.

## Constraints

- Preserve `completion-verification`, `workspace-isolation`, `task-closure`, `review`, `ralph`, `pi-exec`, `skill-authoring`, and `llm-wiki` as Apple Pi fundamentals.
- Replace rather than alias the superseded workflow skills.
- Use Pi's native `disable-model-invocation: true` for explicit human workflows.
- The ledger owns only task-bundle identity/lifecycle; each skill owns any specification, ticket, plan, frontier, research, or prototype artifact it creates inside the bundle.
- Do not add ledger schemas, graph tools, issue-tracker APIs, or another state store.
- Preserve operator authority for commits, publication, destructive actions, and external effects.
- Correct known upstream failure modes: runaway grilling, overactive diagnosis, horizontal ticket slicing, recursive/unverified review, automatic commit, and never-abort merge handling.
- Retain upstream MIT attribution for substantially adapted source.

### WI-001: Establish the target package surface
State: complete
Dependencies: None
Files:
- Modify: `README.md`
- Modify: `tests/package-load.mjs`
- Modify: `THIRD_PARTY_NOTICES.md`
- Modify: `docs/boundaries.md`
- Modify: `docs/ledger.md`
Checks:
- Loader discovers exactly the intended skills and explicit invocation metadata.
Steps:
1. Define retained fundamentals, new adapted skills, and removed paths.
2. Record Matt Pocock source/provenance and the ledger/wiki adaptation boundary.
3. Update the public catalog and loader assertions.

### WI-002: Port explicit human workflows
State: complete
Dependencies: WI-001
Files:
- Add: `skills/grill-with-docs/`
- Add: `skills/to-spec/`
- Add: `skills/to-tickets/`
- Add: `skills/implement/`
- Add: `skills/wayfinder/`
- Add: `skills/improve-codebase-architecture/`
Checks:
- Each skill is hidden from the model prompt and invokable through `/skill:<name>`.
- Task artifacts remain skill-owned inside the active ledger bundle.
- `grill-with-docs` owns its writes and stores derived Markdown beneath `.wiki/` using ordinary file tools.

### WI-003: Port model-invoked engineering disciplines
State: complete
Dependencies: WI-001
Files:
- Add: `skills/prototype/`
- Add: `skills/diagnosing-bugs/`
- Add: `skills/research/`
- Add: `skills/tdd/`
- Add: `skills/domain-modeling/`
- Add: `skills/codebase-design/`
- Add: `skills/resolving-merge-conflicts/`
Checks:
- Descriptions are narrow trigger pointers.
- Supporting references are present and linked only when consumed.
- Research routes task-local evidence to ledger and reusable knowledge to wiki.
- Domain modeling uses `.wiki/` Markdown rather than `CONTEXT.md` at repository root.

### WI-004: Integrate two-axis review into the fundamental review skill
State: complete
Dependencies: WI-001
Files:
- Modify: `skills/review/SKILL.md`
- Preserve/adapt: `skills/review/references/`
Checks:
- Review covers both repository standards and originating intent/specification.
- Root reconciliation, evidence standards, bounded topology, and non-recursive review remain explicit.

### WI-005: Remove superseded workflow skills and stale references
State: complete
Dependencies: WI-002, WI-003, WI-004
Files:
- Remove: `skills/task-shaping/`
- Remove: `skills/implementation-planning/`
- Remove: `skills/plan-execution/`
- Remove: `skills/work-item-orchestration/`
- Remove: `skills/parallel-orchestration/`
- Remove: `skills/root-cause-debugging/`
- Remove: `skills/test-first-development/`
- Remove: `skills/review-commissioning/`
- Remove: `skills/review-reconciliation/`
- Modify: repository docs, prompts, references, and system guidance that name removed skills
Checks:
- Repository search finds no operative references to removed skill names outside task history.

### WI-006: Validate the integrated package
State: complete
Dependencies: WI-005
Checks:
- Format changed Markdown/JavaScript as applicable.
- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run pack:check`
- `git diff --check`
- Inspect the packaged skill inventory and prompt visibility.
