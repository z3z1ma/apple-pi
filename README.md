# apple-pi

Alex's [Pi](https://github.com/badlogic/pi-mono) package: advisor, questions, context, exec, subagents, and the workflow skills I actually use.

The Pi package manifest in [`package.json`](package.json) exports:

- [`extensions`](extensions) as Pi extensions
- [`skills`](skills) as agent skills

MCP protocol and UI stay in the pinned `pi-mcp-adapter` dependency. Everything else is owned here. Feature contracts live in [`docs`](docs); adopted and rejected ideas are in [`docs/boundaries.md`](docs/boundaries.md).

## Install

From a checkout:

```bash
npm install
pi install /absolute/path/to/apple-pi
```

Add `-l` for project-local activation. Pi loads every extension from this one package.

## Extensions

- [`/advisor`](docs/advisor.md) — persistent read-only peer review
- [`ask_user_question`](docs/ask-user-question.md) — structured TUI/RPC questionnaire
- [Context](docs/context.md) — VCC compaction, observational memory, `session_search`, and `memory_source`
- [`pi_exec`](docs/exec.md) — JavaScript composition runtime
- [`mcp`](docs/mcp.md) — the `pi-mcp-adapter` gateway (`mcp`, `/mcp`)
- [`Agent`](docs/subagents.md) — `/agents`, FleetView, and specialist lanes
- [Ledger](docs/ledger.md) — `ledger_add` / `ledger_close` and the `.ledger` contract
- [xAI hosted tools](docs/xai-hosted-tools.md) — injects `{ type: "web_search" }` and `{ type: "x_search" }` on Responses-routed Grok

## Skills

Skills live in [`skills`](skills). Each has a `SKILL.md` plus any references it needs.

- [`/skill:pi-review`](skills/pi-review) — plan focuses, fan out reviewers, verify findings
- [`/skill:pi-ralph`](skills/pi-ralph) — fresh-context implementation loop over a ledger task
- [`/skill:pi-exec`](skills/pi-exec) — how to write `pi_exec` programs
- [`/skill:ledger-shape-task`](skills/ledger-shape-task) — create or refine a task bundle
- [`/skill:ledger-research-task`](skills/ledger-research-task) — investigate before specifying
- [`/skill:ledger-specify-task`](skills/ledger-specify-task) — write the behavioral contract
- [`/skill:ledger-plan-task`](skills/ledger-plan-task) — source-backed implementation plan
- [`/skill:ledger-execute-task`](skills/ledger-execute-task) — run and reconcile the task
- [`/skill:ledger-distill-close-task`](skills/ledger-distill-close-task) — promote lessons and close

## Development

```bash
npm install
npm run format:check
npm run lint
npm run typecheck
npm test
npm run pack:check
```

See [`docs/development.md`](docs/development.md) for module conventions. The VCC suite needs Bun. Networked advisor E2E is opt-in: `ADVISOR_E2E=1 npm run test:advisor`.

## Provenance

Imported source and licenses: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). New apple-pi code is MIT.
