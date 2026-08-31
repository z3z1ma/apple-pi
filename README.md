# apple-pi 🥧

My own personal [Pi](https://github.com/badlogic/pi-mono) package: pair programming, questions, self-reminders, context, exec, subagents, and the workflow skills I actually use.

## Why this exists

This repository is my take on what should be in a coding harness, based on real work, accumulated lessons, and my own taste. Pi is the base that made it practical to build. Above that, the rule is simple: the best software asset has the least code and the most function, clarity, and leverage. AI makes it cheap to add another abstraction, state store, or agent; it does not make the result free to understand. I borrow freely from [Superpowers](https://github.com/obra/superpowers), [10x](https://github.com/z3z1ma/10x), [Prime Intellect](https://github.com/PrimeIntellect-ai/prime-agent), [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent), and anywhere else something works, then reduce it into the version I want to carry.

There is no single success story for [pair programmer](docs/pair-programmer.md). The value is letting the main agent work with a persistent pair programming partner who follows the same session, carries a sourced notebook, and taps it on the shoulder when a nit, concern, or blocker deserves attention. The partner can ask a read-only senior software architect for an independent opinion on difficult questions. The main agent keeps the keyboard and remains responsible for code, decisions, and validation.

Long-horizon context took longer to work out. The persistent [pair programmer](docs/pair-programmer.md) keeps a sourced [notebook](docs/context.md) as the conversation develops: observations record what it sees, reflections keep current conclusions, and the notebook returns after compaction. [10x](https://github.com/z3z1ma/10x) (originally loom) was my first distillation of the rest of this problem, but one project directory growing forever did not match how I work. I work on a task. The [ledger](docs/ledger.md) keeps the operational context that task needs—plans, specifications, notes, decisions, evidence, assets, progress, outcomes, and retrospective learning—together through history when it ends. The default [self-reminder](docs/reminders.md) lets the model explicitly carry selected follow-up work into the next turn without ambient nagging or a second task system. The retained [backlog and to-do extensions](docs/optional-extensions.md) remain available when an installation explicitly wants their managers and persistent execution state. Knowledge that should survive many tasks goes into the [wiki](skills/llm-wiki): Karpathy-style plain files, an index and log, pages and raw sources, with enough structure to accumulate useful context and almost nothing to operate.

[`pi_exec`](docs/exec.md) fundamentally changes how the agent composes work. It can put tools and model calls into bounded JavaScript, then use normal control flow, concurrency, pipelines, fan-out, or map-reduce without dragging every intermediate value through the conversation. The agent reaches for it constantly and writes programs I would never have imagined turning into tools. NVIDIA's [AVO result](https://developer.nvidia.com/blog/nvidia-avo-reaches-100-on-arc-agi-3-demonstrating-a-frontier-level-general-purpose-architecture-for-long-horizon-autonomous-agents/) shows the extreme: Claude Opus 5 inside that harness completed the full public ARC-AGI-3 set—183 levels across 25 environments—with a 100.00 RHAE score. Pi Exec keeps that kind of composition bounded by budgets, concurrency and time limits, cancellation, output limits, and explicit tool bridges. Useful programs can be saved under `.pi/programs`, discovered later, and run again; alongside skills, this gives the agent a legible way to improve its own harness. The built-in [engineering team](docs/subagents.md) gives those fan-outs purposefully different roles—an explorer, a planner, a researcher, a consultant, a builder, and a designer—with prompts, tools, and [model profiles](docs/model-profiles.md) that match the job. The harness only has to suit the way I work, and I am happy to leave out a good idea when carrying it would cost more clarity than it adds.

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

- [`pair programmer`](docs/pair-programmer.md) — a persistent pair programming partner with episodic guidance from a deep software architect
- [`Ask`](docs/ask-user-question.md) — structured TUI/RPC questionnaire
- [`BTW`](docs/btw.md) — private read-only side conversation via `/btw`
- [`Distill`](docs/distill.md) — proposal-first extraction of durable lessons via `/distill [focus]`
- [Custom Footer](docs/status-footer.md) — responsive model, context, cost, Git, and live extension status

### Keeping context and work straight

These handle continuity at different timescales without turning everything into one task system.

- [Notebook](docs/context.md) — Pre-provider auto-compaction, the pair programmer's sourced observations and reflections, `search_session`, and `revisit_note`
- [Self-reminders](docs/reminders.md) — explicit, one-shot model follow-up after the current run
- [The ledger](docs/ledger.md) — `ledger_add` / `ledger_close` and the `.ledger` directory
- [Optional extensions](docs/optional-extensions.md) — retained backlog and to-do systems, not loaded by default

### Running and delegating work

These give the agent more leverage when a task actually benefits from composition or another context.

- [Pi Exec](docs/exec.md) — bounded JavaScript guest for programmatic tool composition, live-session state snapshots, and reusable `.pi/programs`
- [Subagents](docs/subagents.md) — typed specialist lanes, background runs, urgent child-to-root escalation, `/agents`, and FleetView
- [MCP](docs/mcp.md) — the `pi-mcp-adapter` gateway (`mcp`, `/mcp`)

### Terminal and provider edges

These are the smaller integrations that make the whole setup feel like one harness on my machine.

- [Notify](docs/notify.md) — native macOS completion notifications (`/notify-setup`, `/notify-test`) with Ghostty/tmux click-to-focus
- [Tmux sessions](docs/tmux-sessions.md) — publishes per-session `busy`/`idle`/`waiting` status to disk (`/pi-sessions`) for the bundled picker, launcher, and bell forwarding
- [Codex fast mode](docs/codex-fast.md) — `/fast` toggles priority service tier mid-run across root, subagent, and `pi_exec` model calls
- [Home search guard](docs/home-search-guard.md) — blocks agent grep, find, glob, and shell search commands rooted at `$HOME`
- [xAI hosted tools](docs/xai-hosted-tools.md) — injects `{ type: "web_search" }` and `{ type: "x_search" }` on Responses-routed Grok
- [xAI context compaction](docs/context.md) — server-side `/responses/compact` plus opaque-item injection on later Grok Responses requests

The Pi package manifest in [`package.json`](package.json) exports [`extensions`](extensions), [`skills`](skills), and [`prompt templates`](prompts). MCP protocol and UI stay in the pinned `pi-mcp-adapter` dependency; everything else is owned here. Feature contracts live in [`docs`](docs), with adopted and rejected ideas recorded in [`docs/boundaries.md`](docs/boundaries.md).

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
- [`/skill:ralph`](skills/ralph) — bounded fresh-context loops over general goals or prepared ledger tasks

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

See [`docs/development.md`](docs/development.md) for module conventions. Networked pair E2E is opt-in: `PAIR_E2E=1 npm run test:pair`.

## Provenance

Imported source and licenses: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). New apple-pi code is MIT.
