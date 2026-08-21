# apple-pi 🥧

My own personal [Pi](https://github.com/badlogic/pi-mono) package: advisor, questions, context, exec, subagents, and the workflow skills I actually use.

## Why this exists

This is my coding harness. It's the result of spending a lot of time working with AI on real code and distilling what actually matters down to the simplest thing that works.

[Ledger](docs/ledger.md) is the workflow spine. It is not just task storage: it carries authority, provenance, cold-start memory, observed evidence, independent review, and retrospective learning through shaping, orchestration, and execution. Exact trivial work stays trivial; consequential or multi-session work gets one bounded task whose records make the next decision cheaper. Thirteen descriptively named lifecycle skills absorb the old Ledger stages without exposing a `ledger-` naming layer. The general `pi-exec`, `review`, and `ralph` skills retain distinct responsibility boundaries.

The workflow combines the pressure-tested software-engineering procedures adapted from [Superpowers](https://github.com/obra/superpowers) with the durable-judgment philosophy adapted from [10x](https://github.com/z3z1ma/10x), then maps both onto apple-pi's real tools: typed `Agent`, bounded `pi_exec`, fresh Ralph workers, independent review, and operator-controlled integration.

The [advisor](docs/advisor.md) has done more for session quality than anything else I've tried. A persistent second model watches the transcript and sends severity-tagged corrections as the main agent works. You can run a cheaper model for implementation and a stronger model as advisor. The cheaper model makes mistakes; the advisor catches them before they compound. Fewer mistakes means simpler review cycles, which means less wasted context and fewer dead-end trajectories. It runs automatically and stays read-only — it advises, it doesn't take over.

[`pi_exec`](docs/exec.md) is the composition layer. Instead of every tool call being a round trip through the model, the agent writes a bounded JavaScript function that calls tools — read, grep, bash, edit, fetch, MCP, nested model workers — with ordinary control flow. Intermediate output stays in the disposable worker. Only the compact return value enters the parent context. [Review](skills/review) is a `pi_exec` program that plans focuses, fans out parallel workers across partitions of a diff, and runs an independent verifier. [Ralph](skills/ralph) provides bounded fresh-context loops for a general caller-owned goal or a prepared Ledger task, using repository state as memory between iterations. [Skills](skills) prescribe these compositions so the agent doesn't rediscover the workflow every session. Its deliberately small frozen guest `std` library supplies only execution semantics that materially improve on existing guest APIs: normalized change evidence, context budgets and provenance, coverage/reconciliation, one planner-created fan-out topology, and schema-first repository analysis. Ordinary shell, file, HTTP, graph, agent, and mutation work stays on the existing JavaScript and `pi_exec` APIs.

[Agents](docs/subagents.md) are typed specialist lanes — Explore, Research, Plan, Counsel, Implement, and Design — each with tool scope, a semantic [model profile](docs/model-profiles.md), and a role prompt. An Explore agent that can only read is different from an Implement agent that can write. The user-global profile map owns provider/model/thinking policy, so several fast workloads can share `quick` while architecture work uses `deep`. The same catalog serves both the interactive `Agent` tool and `pi_exec` `agents.run`. Custom agents are Markdown files with YAML frontmatter.

[Context](docs/context.md) handles the rest: xAI Responses sessions compact server-side, other models use Pi's default summarizer, observational memory appends its packet after compaction, and two recall paths (`session_search` for transcript history, `memory_source` for exact provenance) let the agent get back to what it needs.

Each piece earns its place. There's some convergence with other projects — [Prime Intellect](https://github.com/PrimeIntellect-ai/prime-agent) arrived at a similar composition-over-REPL idea, [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) explored specialist lanes with tool policies — but this is my own take, shaped by what I've actually watched work and fail over a lot of sessions.

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
- [Context](docs/context.md) — xAI / Pi compaction, observational memory, `session_search`, and `memory_source`
- [`pi_exec`](docs/exec.md) — bounded JavaScript guest for programmatic tool composition, reusable `.pi/programs` (`pi_discover_programs` / `pi_exec_program`)
- [`mcp`](docs/mcp.md) — the `pi-mcp-adapter` gateway (`mcp`, `/mcp`)
- [`Agent`](docs/subagents.md) — `/agents`, FleetView, and specialist lanes
- [Ledger](docs/ledger.md) — `ledger_add` / `ledger_close` and the `.ledger` contract
- [xAI hosted tools](docs/xai-hosted-tools.md) — injects `{ type: "web_search" }` and `{ type: "x_search" }` on Responses-routed Grok
- [xAI context compaction](docs/context.md) — server-side `/responses/compact` plus opaque-item injection on later Grok Responses requests
- [Notify](docs/notify.md) — native macOS completion notifications (`/notify-setup`, `/notify-test`) with Ghostty/tmux click-to-focus
- [Tmux sessions](docs/tmux-sessions.md) — publishes per-session `busy`/`idle`/`waiting` status to disk (`/pi-sessions`) for the bundled tmux picker, launcher, and bell forwarding
- [Input card](docs/status-footer.md) — TUI-only Zentui-style prompt card with responsive model, context, cost, Git, and live extension status presentation

## Skills

Skills live in [`skills`](skills). Each has a `SKILL.md` plus any references it needs.

- [`/skill:task-shaping`](skills/task-shaping) — shape Ledger authority, investigate uncertainty, specify behavior, and approve a design
- [`/skill:implementation-planning`](skills/implementation-planning) — turn an approved specification into source-backed Ledger Work Items
- [`/skill:plan-execution`](skills/plan-execution) — execute an authorized plan sequentially and maintain Ledger evidence
- [`/skill:work-item-orchestration`](skills/work-item-orchestration) — fresh typed implementers with per-Work-Item and final review gates
- [`/skill:parallel-orchestration`](skills/parallel-orchestration) — bounded fan-out over independent domains
- [`/skill:root-cause-debugging`](skills/root-cause-debugging) — investigate root cause before fixing a failure
- [`/skill:test-first-development`](skills/test-first-development) — run the red-green-refactor cycle for behavior changes
- [`/skill:review-commissioning`](skills/review-commissioning) — request independent review through `review`
- [`/skill:review-reconciliation`](skills/review-reconciliation) — verify review feedback before implementing it
- [`/skill:completion-verification`](skills/completion-verification) — gather fresh evidence before completion claims
- [`/skill:workspace-isolation`](skills/workspace-isolation) — establish an approved isolated workspace
- [`/skill:task-closure`](skills/task-closure) — distill and close Ledger state, then present integration choices
- [`/skill:skill-authoring`](skills/skill-authoring) — develop Agent Skills through pressure-tested behavior
- [`/skill:review`](skills/review) — plan focuses, fan out reviewers, verify findings
- [`/skill:ralph`](skills/ralph) — bounded fresh-context loops over general goals or prepared Ledger tasks
- [`/skill:pi-exec`](skills/pi-exec) — author bounded `pi_exec` programs

## Development

```bash
npm install
npm run format:check
npm run lint
npm run typecheck
npm test
npm run pack:check
```

See [`docs/development.md`](docs/development.md) for module conventions. Networked advisor E2E is opt-in: `ADVISOR_E2E=1 npm run test:advisor`.

## Provenance

Imported source and licenses: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). New apple-pi code is MIT.
