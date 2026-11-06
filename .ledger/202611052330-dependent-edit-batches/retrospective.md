Status: done
Created: 2026-11-05
Updated: 2026-11-06

# Retrospective

## What mattered

The first reading of the window rule excluded all useful history because an unrelated toolbox change had just landed. The task owner clarified that the relevant code and prompt lines define a behavior's window. The final scan starts at eaa8e5e2 and ends before candidate development; the run did not silently reach backward.

Independent challenge found 11 material issues in a small guard: path errors spread to siblings, a short regex decoder changed shell filenames, message_end was not a reliable final batch boundary, and replay failures could expose source arguments. The candidate was revised rather than treating 'best-effort' as permission for incorrect decoding or private diagnostics. Tests now include the real Pi SDK and fork path, not only registered-hook fakes.

## Learnings and their owners

- The executing conversation, not a shared message_end snapshot, owns batch identity. Forks and later message transformations made the distinction concrete. This lives in the repo-rules index context file and host regression tests.
- Literal shell paths still need correct quote semantics. The small word decoder now separates word decoding from command-position handling; explicit unsupported syntax remains outside the guarantee. This lives in the matcher context and regression tables.
- Privacy includes failure output. The scan emits fixed diagnostics, safely excludes unavailable unrelated working directories, and counts distinct session identities. Its synthetic tests stay beside the script so the bundle can move to history.
- Biome first rejected the expanded lexer and scanner for complexity; separating the word-decoding and header-selection seams kept each responsibility clear without weakening lint. Typecheck then caught a scripted test's overly broad argument type even though Vitest passed; the fixture now uses ToolCall's actual argument type. Run both checks before reporting green.

## Improvements

The operator approved the guard and tests through sign_off_task, with no annotations. The tool reported the Markdown documents as unopened; approval and document inspection remain distinct facts. A main integration check exceeded the existing prompt budget despite passing in the older candidate worktree. Shorter wording preserved the batch contract and opt-in consent, and brought main to 34,367 / 34,384 estimated tokens without raising the ceiling. Final main focused checks pass (55 Vitest and four scanner tests). Staged source and evidence matched the approved branch before the authorized wording trim; using the index was necessary to include newly added files in that comparison.

A future false-positive rate, complete shell dependency detection and measured model-cost savings are not established. The operator approved the explicit conservative-deferral trade-off. Repairs remain author-tested rather than independently re-captured, following the authorized review budget.
