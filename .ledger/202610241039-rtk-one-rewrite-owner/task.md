Status: in-progress
Created: 2026-10-24
Updated: 2026-10-24

# Delete the rtk tool_call hook: one rewrite owner

## Intent

Settled by an architecture survey (operator-approved report) and an interview the operator confirmed on 2026-10-24. Implement as one ticket with `/skill:implement`.

**Decision.** Delete the `tool_call` hook in `extensions/rtk.ts:23-38` and its `_rtk` and `_rawCommand` fields. `prepareShellCommand` in `components/tasks/src/bash-tool.ts` stays the only place that rewrites commands; `extensions/rtk.ts` keeps only the prompt section.

**In the same change:**
- Delete the unused rtk surface: `RtkStatus.executablePath`, `RewriteOptions.timeoutMs`, `probeRtk`'s `timeoutMs`. Fold the redundant guards: drop the second `"rtk "` prefix check in `bash-tool.ts`, and keep the `RTK_DISABLED` check in `detector.ts:27` (it also gates the prompt section), removing `rewrite.ts:48`. `RTK_DISABLED` accepts only `1` (the doc already says so).
- The readers of the deleted fields use only `args.command` and `details.rtk`: `bash-tool.ts:81,126,206,368`, `terse-tools/src/formatters.ts:389`, `terse-tools/src/patch.ts:429`. The rendering test that asserts `_rawCommand` (`rtk.test.ts:165`) is deleted with the field.
- `AGENTS.md` (the rtk rows) and `docs/rtk.md` say that the tasks bash tool rewrites commands and `extensions/rtk.ts` only adds the prompt section.
- The two rtk tests that need a real `rtk` binary skip, with a message, when it is absent.
- The hook's lifecycle tests are deleted; their verbatim and prefix cases move to the bash-tool tests.

**Accepted consequence.** The RTK marker in the terminal appears at the first partial update instead of at call start.

**Facts that settled branches.** Pi never persists the hook's mutation (it mutates a validated clone; no transcript holds `_rtk` or `_rawCommand`). History reads `details.rtk` and `details.originalCommand` from tool results, which `bash-tool.ts` writes, so old sessions render the same.

**Out of scope.** Moving the remaining terse-tools rendering tests out of `components/rtk/tests`.

**Final check.** Fernanda Park (chief architect) read this cold; her three missing branches (the `RTK_DISABLED` check, the field readers and their test, the docs) were settled in a second round.

## Current State

Ready: design confirmed; acceptance is the full list above, with the rtk, tasks, and terse-tools tests passing.

## Outcome

Pending shaping.

## Progress

- Implemented the whole design in one increment: removed the `tool_call` hook and `_rtk`/`_rawCommand` (extensions/rtk.ts, bash-tool.ts, formatters.ts, patch.ts); dropped `executablePath`, `timeoutMs` options, the second `rtk ` check, and the `RTK_DISABLED` check in rewrite.ts; binary-dependent rtk tests skip when `rtk` is absent; hook tests deleted, `_rawCommand` test deleted, rtk-prefix case added to bash-tool tests; AGENTS.md and docs/rtk.md updated.
- Checks: vitest rtk/tasks/terse-tools 149 passed; `npm run typecheck` passed; Biome check --write on touched files (1 pre-existing-style warning left). Not run: full suite, `npm run lint`.
- Remaining: caller validation (full suite) and commit.
