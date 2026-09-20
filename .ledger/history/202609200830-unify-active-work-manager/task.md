Status: done
Created: 2026-09-20
Updated: 2026-09-20

# Unify active-work management under /work

## Intent

Replace the separate `/agents` and `/tasks` management entrypoints with one focused active-work modal. The modal provides Agents and Tasks tabs, preserves each domain's roster and detail actions, and opens from either `/work` or `Ctrl+W`.

## Current State

Implemented and validated. RED → GREEN: the entrypoint test first failed because `/work` was absent; a roster-height test then exposed that the new tab bar hid the selected final row; and the package loader exposed duplicate `/work` registrations because Pi gives each extension its own API facade. The selected row now stays visible, and a single `extensions/work.ts` owner registers `/work`, both aliases, and `Ctrl+W` while domain extensions contribute sections through Pi's shared event bus. Documentation and package boundaries are current.

## Decisions

- `/work` is the primary entrypoint; `/agents` and `/tasks` remain aliases that open the matching tab.
- `Ctrl+W` opens `/work` and intentionally overrides Pi's default delete-word-backward editor shortcut.
- The modal uses Agents and Tasks tabs with `Tab`/`Shift+Tab` and left/right navigation.
- `extensions/work.ts` is the sole command/shortcut owner; subagents and tasks register domain sections over Pi's event bus because extension API facade identity is not shared.
- Domain-specific detail behavior remains owned by the existing agent and task modules.

## Outcome

- `/work` and `Ctrl+W` open one tabbed manager for public agents and managed tasks.
- `/agents` and `/tasks` remain direct-tab aliases.
- Tab switches preserve per-domain selection; returning from detail restores the same section and item ID.
- Domain roster/detail implementations remain owned by subagents and tasks; their obsolete standalone open loops were removed.
- Modal rendering stays inside the existing 80% terminal-height budget without hiding the selected final row.
- Passed `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` (95 unit files / 1060 tests, 121 pair tests, loader), `npm run pack:check`, and `git diff --check`.
- Ran `graphify update .`. The optional networked pair E2E was not run.
