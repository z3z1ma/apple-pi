Status: done
Created: 2026-08-30
Updated: 2026-08-30

# Simplify the model-facing harness surface

## Intent

Reduce ambient tool and instruction machinery so the model can use its own reasoning while retaining the few structures that materially support execution, continuity, and collaboration.

## Outcome

The default harness uses an explicit, one-shot self-reminder to carry model-selected follow-up work from a settled run into the next turn. The existing to-do and backlog implementations remain available as packaged, tested optional extensions rather than default model surfaces. Pi Exec documents its live guest API in one place. The ledger provides concise operational memory with minimal default scaffolding and a retained retrospective. Model-facing collaboration APIs and prose use consistent lowercase names.

## Scope

- Replace the default to-do and backlog extensions with one `remind_me` tool that queues model-authored follow-ups until the current run settles.
- Preserve the complete to-do and backlog implementations under `optional-extensions/`, packaged and tested but not loaded by default.
- Remove duplicate Pi Exec guest API documentation from the top-level tool description while retaining it on the `code` parameter.
- Remove the ambient workflow manual and replace the ledger prompt with a short operational-memory contract.
- Make new ledger tasks contain only `task.md` and `retrospective.md`; other artifacts and directories are created only when useful.
- Preserve `retrospective.md` as the distilled learning record for every historical task without making the operational task structure otherwise mandatory.
- Rename the model-facing `Agent` tool to `agent` and Pi Exec's structured `agents.run` API to `agent.run` while preserving their distinct collaboration and composition behaviors.
- Refer to the ledger and the pair programmer as common nouns in model-facing and human-facing prose.
- Update the package surface, tests, skills, and closest documentation for the approved changes.

## Non-goals

- Remove saved Pi Exec programs or trim its standard web and JavaScript API documentation.
- Merge the interactive teammate tool with Pi Exec workers.
- Merge the ledger with the pair programmer's notebook or the llm wiki.
- Delete the retired to-do or backlog implementations.
- Rename internal TypeScript symbols or external standards solely for cosmetic consistency when they do not leak into prose.

## Acceptance Criteria

- AC-001: `remind_me` accumulates calls made during one root run and emits one visible, model-triggering follow-up when that run settles.
- AC-002: A delivered reminder batch is cleared before delivery, is not emitted again automatically, and no message is emitted when the queue is empty.
- AC-003: Session lifecycle changes clear any undelivered in-memory reminder queue.
- AC-004: The default package exposes no backlog or to-do tools, commands, prompts, widgets, or recurring reminders.
- AC-005: The prior backlog and to-do extensions remain packaged, directly loadable, documented as optional, and covered by their existing tests.
- AC-006: The full Pi Exec guest API contract appears on the `code` parameter but not in the top-level tool description.
- AC-007: The default root receives one concise ledger contract and no separate workflow manual.
- AC-008: New ledger tasks contain `task.md` and `retrospective.md` without empty supporting directories; existing tasks remain valid.
- AC-009: The retrospective remains the concise historical learning artifact and is not replaced by raw operational logs.
- AC-010: Root and nested collaboration tools are named `agent`, and Pi Exec exposes callable `agent()` plus structured `agent.run()` without a model-facing `agents` namespace.
- AC-011: Model-facing and human-facing prose refers to the ledger and the pair programmer as common nouns, except external proper names and code identifiers.
- AC-012: Relevant formatting, lint, type, behavior, loader, and package-surface checks pass.

## Result

The default package now exposes 15 custom root tools instead of 25. Comparable serialized tool metadata fell from about 64.8k to 43.3k characters; Pi Exec itself fell from about 42.5k to 23.1k by keeping the full guest contract only on the `code` parameter. The separate workflow prompt is gone, the ledger prompt is concise, reminders batch at the settled-run boundary, and the retained backlog and to-do systems are packaged only as optional extensions.

The complete relevant suite passed in an isolated snapshot: formatting, lint, typecheck, 725 unit tests, 105 pair-programmer checks, loader checks, and package-content inspection. The snapshot restored an unrelated concurrent Codex extension rename to `HEAD`; that separate unfinished lane prevents the same commands from running coherently in the shared working tree.

## Constraints

- Use `optional-extensions/`, not `parked-extensions/`: the retained extensions remain supported and testable rather than dead source.
- A self-reminder is immediate next-turn guidance, not a scheduler, persistent checklist, task inventory, or new source of authority.
- Keep `pi_exec`, saved programs, interactive teammates, and composed-worker behavior otherwise unchanged.
- Keep one retrospective file in every newly created ledger task; simplify its purpose and template rather than removing it.
- Preserve unrelated work in the repository.

## References

- `optional-extensions/todos/`
- `optional-extensions/backlog/`
- `extensions/runtime-api.ts`
- `components/shared/src/ledger-system-prompt.ts`
