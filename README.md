# apple-pi 🥧

My own personal [Pi](https://github.com/badlogic/pi-mono) package: advisor, questions, session backlog and active to-dos, context, exec, subagents, and the workflow skills I actually use.

## Why this exists

This is my coding harness. It's the result of spending a lot of time working with AI on real code and distilling what actually matters down to the simplest thing that works.

[Ledger](docs/ledger.md) is optional continuity for consequential, coordinated, or multi-session work. Clear bounded instructions execute directly; tasks, specifications, plans, evidence, and retrospectives are added only when they make the next decision cheaper. The workflow skills scale from a fast root-session edit to durable orchestration without turning lifecycle artifacts into the product. The general `pi-exec`, `review`, and `ralph` skills retain distinct responsibility boundaries.

The workflow combines lessons adapted from [Superpowers](https://github.com/obra/superpowers) and [10x](https://github.com/z3z1ma/10x) with a modern progressive default: build the smallest useful increment, validate it cheaply, and escalate process only when concrete ambiguity, risk, coordination, or observed failure earns it. Typed `Agent`, bounded `pi_exec`, Ralph, and independent review are opt-in leverage rather than automatic gates.

The [advisor](docs/advisor.md) has done more for session quality than anything else I've tried. A persistent second model watches the transcript and sends severity-tagged corrections as the main agent works. You can run a cheaper model for implementation and a stronger model as advisor. The cheaper model makes mistakes; the advisor catches them before they compound. Fewer mistakes means simpler review cycles, which means less wasted context and fewer dead-end trajectories. It runs automatically and stays read-only — it advises, it doesn't take over.

[`pi_exec`](docs/exec.md) is the composition layer. Instead of every tool call being a round trip through the model, the agent writes a bounded JavaScript function that calls tools — read, grep, bash, edit, fetch, MCP, nested model workers — with ordinary control flow. Intermediate output stays in the disposable worker. Only the compact return value enters the parent context. [Review](skills/review) defaults to direct bounded inspection and can opt into one independent reviewer or exceptional multi-lens programs when risk warrants their cost. [Ralph](skills/ralph) provides explicitly requested bounded fresh-context loops. [Skills](skills) guide work without forcing every available capability into every task. The frozen guest `std` library supplies bounded execution primitives such as normalized Git evidence, context budgets, coverage, reconciliation, and relevant-test selection.

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

## What's in the harness

I think about the package in four groups. They are all installed together, but each has a different job and most of them stay out of the way until they are useful.

### Working with the agent

These are the pieces I interact with directly while a session is running.

- [`Advisor`](docs/advisor.md) — persistent read-only peer review
- [`Ask`](docs/ask-user-question.md) — structured TUI/RPC questionnaire
- [Custom Footer](docs/status-footer.md) — responsive model, context, cost, Git, and live extension status

### Keeping context and work straight

These handle continuity at different timescales without turning everything into one task system.

- [Context](docs/context.md) — Observational memory, `session_search`, and `memory_source`
- [Session Backlog](docs/backlog.md) — model-assisted parking with a human-owned `/backlog` manager
- [To-dos](docs/todos.md) — active-execution checklist, `/todos` manager, branch snapshots, and owned subagent runs
- [Ledger](docs/ledger.md) — `ledger_add` / `ledger_close` and the `.ledger` directory

### Running and delegating work

These give the agent more leverage when a task actually benefits from composition or another context.

- [Pi Exec](docs/exec.md) — bounded JavaScript guest for programmatic tool composition and reusable `.pi/programs`
- [Subagents](docs/subagents.md) — typed specialist lanes, background runs, `/agents`, and FleetView
- [MCP](docs/mcp.md) — the `pi-mcp-adapter` gateway (`mcp`, `/mcp`)

### Terminal and provider edges

These are the smaller integrations that make the whole setup feel like one harness on my machine.

- [Notify](docs/notify.md) — native macOS completion notifications (`/notify-setup`, `/notify-test`) with Ghostty/tmux click-to-focus
- [Tmux sessions](docs/tmux-sessions.md) — publishes per-session `busy`/`idle`/`waiting` status to disk (`/pi-sessions`) for the bundled picker, launcher, and bell forwarding
- [xAI hosted tools](docs/xai-hosted-tools.md) — injects `{ type: "web_search" }` and `{ type: "x_search" }` on Responses-routed Grok
- [xAI context compaction](docs/context.md) — server-side `/responses/compact` plus opaque-item injection on later Grok Responses requests

## Skills

Skills live in [`skills`](skills). Each has a `SKILL.md` plus any references it needs. They are procedures the agent can load when the situation calls for them, not a pipeline every request has to follow.

### Workflow skills

These cover the path from figuring out what the work means through implementation, verification, and integration.

- [`/skill:task-shaping`](skills/task-shaping) — collaborate on genuinely unresolved product or architecture choices
- [`/skill:implementation-planning`](skills/implementation-planning) — plan settled multi-step work when sequencing or ownership adds value
- [`/skill:plan-execution`](skills/plan-execution) — execute an authorized plan directly in the root session
- [`/skill:work-item-orchestration`](skills/work-item-orchestration) — delegate substantial independent Work Items when the cost is justified
- [`/skill:parallel-orchestration`](skills/parallel-orchestration) — parallelize substantial non-overlapping domains
- [`/skill:root-cause-debugging`](skills/root-cause-debugging) — find and fix a failure from the cheapest discriminating evidence
- [`/skill:test-first-development`](skills/test-first-development) — use focused test-first checks where they improve feedback
- [`/skill:review-commissioning`](skills/review-commissioning) — add one risk-justified independent reviewer during ongoing work
- [`/skill:review-reconciliation`](skills/review-reconciliation) — validate feedback once and handle fixes in the root
- [`/skill:completion-verification`](skills/completion-verification) — match fresh verification breadth to the claim
- [`/skill:workspace-isolation`](skills/workspace-isolation) — isolate work when overlap or destructive experimentation warrants it
- [`/skill:task-closure`](skills/task-closure) — verify, archive, and follow the operator's integration direction

### Review and iteration

These provide bounded ways to inspect a change or make progress through fresh-context iterations.

- [`/skill:review`](skills/review) — inspect directly or use the smallest justified independent topology
- [`/skill:ralph`](skills/ralph) — bounded fresh-context loops over general goals or prepared Ledger tasks

### Harness authoring

These help build the reusable procedures and composition programs that extend the harness itself.

- [`/skill:pi-exec`](skills/pi-exec) — author bounded `pi_exec` programs
- [`/skill:skill-authoring`](skills/skill-authoring) — write concise Agent Skills with progressive validation

### Project knowledge

- [`/skill:llm-wiki`](skills/llm-wiki) — maintain durable project-local knowledge in `.wiki/`

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
