# Prototype

Source: `mattpocock/skills` at `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`

Status: approved; implementation and targeted validation complete

## Target

Preserve upstream `prototype` as throwaway code that answers one design question. The question selects one of two complete branches: a self-contained interactive HTML demo for logic/state, or several radically different switchable variants for visual UI. Prototype artifacts and their verdict remain task-local execution evidence inside the governing active ledger bundle.

## Fidelity accounting

The operator-approved package layout moves both supplementary files under `references/`:

- `references/logic.md` preserves the complete shareable-demo process, pure portable logic shape, guided scenarios, handoff, and anti-patterns.
- `references/ui.md` preserves the complete existing-page/new-page split, three-variant default, switcher behavior, production guard, handoff, cleanup, and anti-patterns.

Apple Pi translations are limited to:

1. The canonical runnable prototype, question, verdict, and run instructions live inside the active `.ledger/<task>/` bundle rather than beside production code.
2. UI prototypes retain the upstream existing-page/new-route evaluation surfaces. When a framework requires route-local files, they are minimal temporary wiring or working copies; the evaluated variants remain in the ledger and the production-tree copies are removed after the verdict.
3. Production adoption, branch creation, commits, and external issue updates remain operator-authorized effects. Upstream-style throwaway-branch capture is optional and must also fit repository ledger-storage policy; any branch pointer is recorded in the ledger.
4. Delegated UI prototype work has one `designer` teammate own all variants and the shared switcher so parallel writers do not collide on one route.
5. Relative links follow the `references/` layout.

No wiki artifact or Pi Exec program is introduced. Every upstream rule governing throwaway scope, runnability, in-memory state, lack of tests/abstractions, visible state, prototype evaluation, and production-tree cleanup remains.

## Validation

- Pi's real skill loader discovers `prototype` with no diagnostics and keeps model invocation enabled.
- Every local Markdown reference resolves from the final `references/` paths.
- The package dry run contains `SKILL.md`, `references/logic.md`, and `references/ui.md`.
- Source diffs confirm the only upstream changes are reference paths, ledger artifact placement, the narrow temporary UI-route exception, operator authority, and single-Designer ownership.
- Focused phrase checks confirm the canonical ledger location and production-tree cleanup in the main skill and both branch references.
- `git diff --check` passes.
