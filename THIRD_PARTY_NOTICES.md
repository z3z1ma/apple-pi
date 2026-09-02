# Third-party notices

apple-pi contains modified source imports and one pinned runtime dependency. apple-pi takes maintenance responsibility for copied sources; the MCP dependency retains upstream protocol/auth maintenance ownership.

## pi-omplike-advisor → pair programmer

- Source: <https://github.com/pasky/pi-omplike-advisor>
- Imported commit: `43eb9a976d751c06016a62b5423e2c6ddaff43a1`
- Author named by the source package: Petr Baudis
- Local paths: `components/pair-programmer/`, `extensions/pi-pair.ts`
- License: MIT, as declared by the source package metadata. The imported commit did not contain a standalone license file or separate copyright notice.

## rpiv-ask-user-question → Ask User Question

- Source: <https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question>
- Imported commit: `d0eb55371f622ac524b3355711a482f95feb14d4`
- Upstream version at import: `2.6.0`
- Author named by the source package: juicesharp
- Local paths: `components/ask-user-question/`, `extensions/ask-user-question.ts`
- License: MIT
- Original notice: `Copyright (c) 2026 juicesharp`
- The local implementation adapts the upstream tool schema, validation, structured response, TUI questionnaire, RPC fallback, and non-interactive tool reconciliation. It intentionally omits upstream configuration, localization, previews, notes, collapse mode, external-editor integration, and lifecycle events.

## pi-vcc

- Source: <https://github.com/monotykamary/pi-vcc>
- Imported commit: `664148ec91eb2b160164bb91bb1ebf926c1ad519`
- Commit author: Tom X Nguyen
- Local path: `components/session-search/` (recall only); integration in `extensions/session-search.ts` and `extensions/context.ts`
- License: MIT, as declared by the source README. The imported commit did not contain a standalone license file or separate copyright notice.

## pi-auto-compact → Oversized-result compaction fallback

- Source: <https://github.com/tmustier/pi-auto-compact>
- Imported commit: `377f1d2a04c038d934903eeffb0dcc1c4edb3697`
- Upstream version at import: `0.1.9`
- Author named by the source package: Thomas Mustier
- Local paths: `components/notebook/src/hooks/overflow-guard.ts`, `extensions/auto-compact.ts`; explicit child/worker loading in `components/subagents/src/agent-runner.ts` and `extensions/runtime-agent.ts`
- License: MIT
- Original notice: `Copyright (c) 2026 Thomas Mustier`
- apple-pi retains the upstream fail-closed goal, but no longer replaces provider streams or produces a synthetic assistant response. When an over-budget tool-result batch leaves Pi 0.84.4 without a valid cut point, Apple Pi appends a hidden custom-message marker and lets native threshold compaction proceed; failed automatic compaction is gated before provider dispatch. The implementation omits upstream's provider interception, separate config file, rules engine, status command, dedicated compaction-model selection, and policy event protocol.

## pi-observational-memory

- Source: <https://github.com/elpapi42/pi-observational-memory>
- Imported commit: `37986b6faa1e39eb5aa1d03a4ca6379ecaf3148d`
- Local path: `components/notebook/`; integration in `extensions/context.ts`
- License: MIT
- Original notice: `Copyright (c) 2026 pi-observational-memory contributors`

## pi-subagents

- Source: <https://github.com/tintinweb/pi-subagents>
- Imported commit: `5f8dedad1e8d80322b71020f2b5ddc8ab348c30f`
- Upstream version at import: `0.16.1`
- Author named by the source package: tintinweb
- Local paths: `components/subagents/`, `extensions/subagents.ts`
- License: MIT
- Original notice: `Copyright (c) 2026 tintinweb`
- Adopted code was substantially reduced and integrated. Retained responsibilities include Markdown agent discovery, Pi AgentSession execution, foreground/background management, nested delegation, result/steering tools, usage and compaction tracking, widgets, FleetView, and the conversation viewer. Worktree isolation, scheduling, prompt mentions, plugin-local memory, duplicate output transcripts, cross-extension RPC, and model-scope policy were removed.

## pi-tasks → To-dos

- Source: <https://github.com/tintinweb/pi-tasks>
- Imported commit: `86a559cf5e378cc21fa0c7015a92c358e7227094`
- Upstream version at import: `0.8.0`
- Author named by the source package: tintinweb
- Local paths: `optional-extensions/todos/`, `docs/todos.md`, `docs/optional-extensions.md`, `tests/package-load.mjs`
- License: MIT
- Original notice: `Copyright (c) 2026 tintinweb`
- apple-pi adapts the upstream active-checklist model, dependency validation/display, branch-aware snapshots, safe shared-project persistence concepts, data-only settings, reminders, auto-clear, manager/widget concepts, and execution cascade. It replaces upstream aliases and external execution paths with lowercase native tools and apple-pi's owned managed-subagent service; it does not retain the generic process tracker, compatibility storage, arbitrary metadata, independently stored reverse edges, or reference media.

## pi-notify → Notify

- Source: <https://github.com/Async23/pi-packages/tree/main/packages/notify>
- Imported commit: `b3f7f44e21aaf9d20ce9a7d5f96a5c8781fd5127`
- Upstream version at import: `0.1.1`
- Author named by the source package: Async23
- Local paths: `components/notify/`, `extensions/notify.ts`
- License: MIT
- Original notice: `Copyright (c) 2026 Async23`
- The extension code, scripts, and assets were adopted largely as-is. All Chinese user-facing strings were translated to English (notification bodies, subtitles, error/cancellation summaries, and the generic-heading skip list), the `agent_settled` delivery path was gated to macOS, and the test suite was ported from `node:test` to Vitest.

## pi-mcp-adapter (runtime dependency)

- Source: <https://github.com/nicobailon/pi-mcp-adapter>
- Reviewed commit: `5ee81b47b571b3c4ac2e68a03812c64e3f95cb98`
- Pinned npm version: `2.26.0`
- Author named by the source package: Nico Bailon
- Integration path: `extensions/mcp.ts`
- License: MIT
- Original notice: `Copyright (c) 2026 Nico Bailon`
- Boundary: the upstream package is installed as a normal npm dependency; its source is not copied into apple-pi. apple-pi suppresses only the duplicate `mcpScript` tool at registration and exposes the adapter's `mcp` gateway to ordinary Pi turns and `pi_exec`. The dependency retains ownership of MCP transports, protocol negotiation, lifecycle, OAuth/keyring storage, approvals, output guarding, prompts/resources, and MCP UI behavior.

## tmux-claude-session-manager → Tmux sessions

- Source: <https://github.com/craftzdog/tmux-claude-session-manager>
- Author named by the source package: Takuya Matsuyama
- Local paths: `components/tmux-sessions/` (bash scripts, `pi_session_manager.tmux`); the status-publishing extension in `components/tmux-sessions/src/` and `extensions/tmux-sessions.ts` is original to apple-pi
- License: MIT
- Original notice: `Copyright (c) 2026 Takuya Matsuyama` (reproduced verbatim in `components/tmux-sessions/LICENSE`)
- The bash picker, launcher, popup-in-popup handling, and bell forwarding are adapted from upstream and retargeted from Claude Code to Pi. Pi has no `claude agents --json` equivalent, so status comes from JSON records the apple-pi extension writes to disk (`agents.sh` reads those records and joins them to tmux panes) rather than from an external agent command. Session prefix, tmux options, and command default were renamed to the `pi`/`@pi_*` namespace.

## mattpocock/skills → engineering workflows and disciplines

- Source: <https://github.com/mattpocock/skills>
- Imported commit: `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`
- Author named by the source package: Matt Pocock
- Local paths: `prompts/interrogate.md`, `skills/interrogate-to-design/`, `skills/to-spec/`, `skills/to-tickets/`, `skills/implement/`, `skills/improve-codebase-architecture/`, `skills/wayfinder/`, `skills/prototype/`, `skills/diagnosing-bugs/`, `skills/research/`, `skills/tdd/`, `skills/resolving-merge-conflicts/`, `skills/domain-modeling/`, `skills/codebase-design/`, `skills/code-review/SKILL.md`, `skills/code-review/references/smell-baseline.md`
- License: MIT
- Original notice: `Copyright (c) 2026 Matt Pocock`
- apple-pi retains the implemented engineering methods while adapting task artifacts, reusable context, agents, review reconciliation, and Git authority to its own harness. Task artifacts live freely inside their governing ledger bundle; reusable LLM-derived documentation lives under `.wiki/`.
- Source-path accounting: upstream `grilling` and `grill-with-docs` map to the explicit `/interrogate` prompt and human-only `interrogate-to-design` skill; `to-spec` keeps upstream synthesis and seam confirmation while defaulting publication to a semantically governing live ledger bundle; `to-tickets` keeps upstream tracer bullets, blockers, frontier, quiz, and expand–contract guidance while defaulting one file per ticket to that bundle; `implement` keeps upstream's settled-work → TDD → feedback → review → commit loop while composing Apple Pi's adopted TDD/review contracts, authority boundaries, and direct Builder fan-out for selected parallel tickets; `improve-codebase-architecture` keeps upstream's hot-spot survey, deletion test, visual report, candidate selection, and design interrogation while mapping domain context to `.wiki/` and composing installed skills through explicit package references; `wayfinder` keeps upstream's destination-first map, fog, frontier, decision-ticket types, and one-ticket-per-session loop while storing `map.md` plus `decisions/` in a governing ledger bundle, resolving research through the installed research skill, treating file claims as advisory, and requiring operator-backed execution authority rather than trusting agent-authored Notes; upstream `code-review` is consolidated into Apple Pi's `code-review`; `ask-matt` maps to the person-neutral built-in consultant rather than a skill; `setup-matt-pocock-skills` maps to package installation and loader validation; issue-tracker-oriented `triage` is outside Apple Pi's tracker-free task-bundle model; and `wizard` maps to native skill discovery plus explicit `/skill:` invocation.

## obra/superpowers → retained apple-pi fundamentals

- Source: <https://github.com/obra/superpowers>
- Imported commit: `b36e0829c6d0140e93cfef2ca599b1b07d4a7797`
- Author named by the source package: Jesse Vincent
- Local paths: `skills/completion-verification/`, `skills/workspace-isolation/`, `skills/task-closure/`, `skills/skill-authoring/`
- License: MIT
- Original notice: `Copyright (c) 2025 Jesse Vincent`
- These retained skills express Apple Pi's verification, isolation, integration-authority, and skill-authoring fundamentals. apple-pi retains maintenance responsibility for the adapted paths.

## z3z1ma/10x → ledger foundation

- Source: <https://github.com/z3z1ma/10x>
- Reviewed and adapted commit: `4616e5c07d6f9b82fb299ef18446280ab6f1e09d`
- Author and copyright holder named by the source: Alexander M. Butler
- Local paths: `components/shared/src/ledger-system-prompt.ts`, `docs/ledger.md`, `README.md`, `AGENTS.md`, `skills/completion-verification/`, `skills/task-closure/`, and `.ledger/history/202608202254-strengthen-ledger-workflow/research/ten-x-ledger-philosophy.md`
- License: MIT
- Original notice: `Copyright (c) 2026 Alexander M. Butler`
- apple-pi adapts 10x's durable-judgment concepts—authority and provenance, evidence limits, adversarial review, proportional task records, retrospective compounding, and instruction evaluation—into its open-ended task bundles, verification, and closure procedures. It does not import `.10x/`, the separate record hierarchy, or the autoresearch Python runtime.

## MIT license applying to the imported works

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Conceptual references only

No source code was copied from these projects:

- `pi-blackhole` (`49ab560`) and Sting8k's `pi-vcc` (`09c4a74`) informed the single compaction owner and progressive touched-file / `#N:path` recall design. Their unified and reverse-recall implementations were not adopted.
- `pi-fabric` (`843dadb`) informed `pi_exec`'s guest program, host-tool and registered-extension bridge, programmable subagents, durable nested traces, code preview, live-call rendering, and activity-widget concepts. apple-pi independently implements the execution-focused runtime with Node's standard worker and VM modules.
- `pi-btw` (`763850adf8c51e1dbc13765ad1197e20853ab631`, <https://github.com/QuangThai/pi-btw>) informed the private `/btw` side-conversation, answer-first UI, and explicit injection behavior. apple-pi independently implements them on the existing owned child-session manager and Pi TUI primitives; no upstream source code, RPC process layer, slot system, settings, logs, fallback inference, or history store was copied.
- Geoffrey Huntley's Ralph writings (<https://ghuntley.com/ralph/> and <https://ghuntley.com/loop/>) informed the fresh-context, one-increment-per-loop, deterministic-stack, backpressure, and outer-harness model. No source code was copied.
