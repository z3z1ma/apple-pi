Status: done
Created: 2026-10-13
Updated: 2026-10-13

# Upgrade to Pi 1.2 and adopt its native integration points

## Intent

Act on every recommendation in `docs/research/pi-1.2-upgrade-assessment.md` (user: "Address all of these").

## Acceptance criteria

- Dev dependencies on all four Pi packages are 1.2.0; peers require >=1.2.0 where 1.2 APIs are used.
- `npm run check`, `npm test`, and `npm run pack:check` pass.
- Notify narrows the `before_agent_start` union and labels custom-started runs from their starting message; settled handling uses `event.aborted`.
- A test proves a custom `triggerTurn` wake-up keeps apple-pi prompt sections on its first and later provider requests.
- `pi_exec` and saved `program_*` tools declare `reachesTools`.
- `pi_exec` captured-tool calls go through `ctx.executeTool()` (native hooks, exposure, usage) and return `structuredContent` and `isError`.
- Python declarations show schema constraints (range, length, pattern, default).
- Terse tool rows use public `durationMs`/`outputPad` where they replace internals.
- Setup docs show `$schema`; docs updated for MCP/exec/tmux/clipboard facts.
- Pi Exec workers keep partial text when print mode exits 1 on truncation; subagent length-stop policy decided and tested.
- Real-terminal check of the TUI patches under Pi 1.2.

## Current State

Implemented and validated; awaiting commit.

## Outcome

- Deps 1.2.0, peers >=1.2.0. `npm run check`, `npm run test:unit` (131 files, 1436 tests), `test:pair` (118/118), `test:loader`, and `pack:check` pass.
- Notify narrows the start union, labels custom-started runs from their message, and reads `agent_settled.aborted`.
- `tests/custom-wake-prompt.test.ts`: a triggered custom run fires `before_agent_start` (custom) and keeps the ledger section on both provider requests.
- Pi Exec: `tool-capture.ts` deleted; `callable-tools.ts` reads `ctx.tools`; extension, MCP, and active core tools (not `bash`) run through `ctx.executeTool()`; results carry `structuredContent` and `isError`; failures raise unless structured data came back; Pi aggregates nested usage. `pi_exec` and `program_*` declare `reachesTools: "all"`. The MCP e2e drives a real turn and proves a `tool_call` hook blocks a nested call.
- Active core tools' registered schemas drive type-check stubs.
- Length stops: Pi Exec workers and SDK children report failure and keep the partial text.
- Docs: exec, mcp, boundaries, change-reflection, setup (`$schema`, `PI_CLIPBOARD_OSC52`), tmux-sessions (OSC 7501), README, AGENTS.
- Real tmux run on installed Pi 1.2.0: terse rows render collapsed/expanded at 160 and 80 columns; the session file records the program's `read` under `nestedCalls`.
- Dropped with reason: Python constraint tags, tool-row `durationMs` (see assessment Outcome).
