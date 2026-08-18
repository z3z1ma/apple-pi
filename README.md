# apple-pi 🥧

My own personal [Pi](https://github.com/badlogic/pi-mono) package: advisor, questions, context, exec, subagents, and the workflow skills I actually use.

## Why this exists

Every coding harness gives the model a list of tools and a conversation loop. Read a file — that's a model turn. Grep for a symbol — another turn. Spawn a subagent — another turn. Each result dumps into the context window and the model spends tokens deciding what to do next.

[`pi_exec`](docs/exec.md) adds a composition layer on top of those tools. The agent writes a bounded JavaScript function that can call any of them — read, grep, bash, edit, fetch, MCP, nested model workers — with loops, branches, `Promise.all`, reduce. Intermediate output stays inside the disposable worker. Only the compact return value enters the parent context.

The [review skill](skills/pi-review) is a good example. When the agent reviews a change, it writes a `pi_exec` program that plans review focuses, fans out parallel read-only workers each scoped to a different partition of the diff, then runs an independent verifier over the candidates. The workers still make model calls, but their verbose output never touches the parent window. What comes back is structured findings.

[Ralph](skills/pi-ralph) works the same way. The agent writes a program that spawns fresh-context agents in sequence. Each one gets a clean window, reads the ledger for where things left off, does one increment, and exits. The repository is the memory. The next iteration starts from zero.

Skills prescribe these compositions. The review skill tells the agent how to write the review program. The Ralph skill tells it how to write the iteration loop. The procedure lives in the skill, so it survives across sessions — the agent doesn't rediscover the workflow every time. A guest standard library of reusable functions (exploration, review patterns, structured code analysis) is the next layer I plan to build up. Skills prescribe the workflow; the stdlib provides the building blocks.

[Prime Intellect](https://github.com/PrimeIntellect-ai/prime-agent) recently shipped Prime Agent around the same idea — a persistent Python REPL where tools and subagents are function calls. Our version came through [Pi Fabric](docs/boundaries.md), which drew some inspiration from their earlier work. The convergence is worth noting.

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
- [`pi_exec`](docs/exec.md) — bounded JavaScript guest for programmatic tool composition
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
