Status: open
Created: 2026-08-31
Updated: 2026-09-01

# Retrospective

## First rejected port

The first adaptation failed because passing tests proved consistency, not an agreed design. Persistence locations are homes, not schemas. Skills should describe the current procedure a fresh model needs; provenance belongs in project documentation. Human-only invocation is a capability boundary only when every discovery path, including Pi Exec `skills.list`/`skills.body`, respects it.

## What mattered in the successful port

Study each skill from pinned upstream source, then change only platform mappings, existing dependency contracts, or approved policy. Do not rewrite Matt's doctrine into Apple Pi nouns.

The useful Apple Pi mappings were few and repeated:

- Task artifacts go in a semantically governing ledger bundle. One live index row is not ownership.
- Reusable knowledge goes in `.wiki/`. ADRs, docs, and tests remain authority.
- Flat independent work uses direct teammates. Pi Exec is for real graphs.
- Pi has no Skill tool. Name the installed skill; the model can load its `SKILL.md`.
- Commits, publication, tracker mutation, and ticket-state changes stay separately authorized unless the skill owns that artifact.

Decision tickets and implementation tickets must not share a path. Wayfinder `decisions/` and `to-tickets` `tickets/` stay distinct.

Research tickets gather facts. Prototype tickets raise fidelity. Throwaway Git branches were only a parking place for notes and have no writer in Apple Pi's read-only Researcher.

## Learnings

- Confirm destination ownership before writing. `ledger_add` and external publication need explicit approval.
- Keep round boundaries: ask a complete frontier, recommend, then stop and wait.
- Preserve literal upstream constraints that look verbose (long user stories, six-word wins, deletion test as a gate). Softening them loses the method.
- Follow upstream even when its failure mode is documented, unless the operator chooses a hard stop. Wayfinder Notes may still carry execution.
- Selective commits keep unrelated dirty-tree work intact. Ledger studies stay uncommitted unless the owner wants them.

## Improvements

Keep this study-then-approve loop for future external skill imports. Do not restore `ask-matt`, a setup skill, triage, a Skill-tool bridge, or a `review` alias without a new product contract.
