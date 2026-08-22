# Third-party notices

apple-pi contains modified source imports and one pinned runtime dependency. apple-pi takes maintenance responsibility for copied sources; the MCP dependency retains upstream protocol/auth maintenance ownership.

## pi-omplike-advisor → Pi Advisor

- Source: <https://github.com/pasky/pi-omplike-advisor>
- Imported commit: `43eb9a976d751c06016a62b5423e2c6ddaff43a1`
- Author named by the source package: Petr Baudis
- Local paths: `components/advisor/`, `extensions/pi-advisor.ts`
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

## pi-observational-memory

- Source: <https://github.com/elpapi42/pi-observational-memory>
- Imported commit: `37986b6faa1e39eb5aa1d03a4ca6379ecaf3148d`
- Local path: `components/memory/`; integration in `extensions/context.ts`
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
- Local paths: `components/todos/`, `extensions/todos.ts`, `docs/todos.md`, `components/shared/src/workflow-system-prompt.ts`, `tests/ledger-prompt-integration.test.ts`, `tests/package-load.mjs`
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

## obra/superpowers → apple-pi workflow and engineering skills

- Source: <https://github.com/obra/superpowers>
- Imported commit: `b36e0829c6d0140e93cfef2ca599b1b07d4a7797`
- Author named by the source package: Jesse Vincent
- Local paths: `components/shared/src/workflow-system-prompt.ts`, `extensions/workflow.ts`, `skills/task-shaping/`, `skills/implementation-planning/`, `skills/plan-execution/`, `skills/work-item-orchestration/`, `skills/parallel-orchestration/`, `skills/root-cause-debugging/`, `skills/test-first-development/`, `skills/review-commissioning/`, `skills/review-reconciliation/`, `skills/completion-verification/`, `skills/workspace-isolation/`, `skills/task-closure/`, `skills/skill-authoring/`, `tests/ledger-prompt-integration.test.ts`, `tests/package-load.mjs`
- License: MIT
- Original notice: `Copyright (c) 2025 Jesse Vincent`
- The injected root prompt adapts upstream skill-routing behavior to Pi's native available-skills catalog and package discovery. The listed engineering skills retain the upstream process while translating storage, skill references, operator authority, Ledger ownership, and worktree integration to apple-pi. apple-pi retains maintenance responsibility for these adapted paths.

## z3z1ma/10x → Ledger foundation

- Source: <https://github.com/z3z1ma/10x>
- Reviewed and adapted commit: `4616e5c07d6f9b82fb299ef18446280ab6f1e09d`
- Author and copyright holder named by the source: Alexander M. Butler
- Local paths: `components/shared/src/ledger-system-prompt.ts`, `components/shared/src/workflow-system-prompt.ts`, `docs/ledger.md`, `README.md`, `AGENTS.md`, the lifecycle `skills/*/SKILL.md` files listed in the package catalog, and `.ledger/history/202608202254-strengthen-ledger-workflow/research/ten-x-ledger-philosophy.md`
- License: MIT
- Original notice: `Copyright (c) 2026 Alexander M. Butler`
- apple-pi adapts 10x's durable-judgment concepts—authority and provenance, shaping/orchestration/execution separation, evidence limits, adversarial review, proportional records, retrospective compounding, and instruction evaluation—into the existing single-task Ledger bundle and descriptively named lifecycle skills. It does not import `.10x/`, the separate record hierarchy, or the autoresearch Python runtime.

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
- Geoffrey Huntley's Ralph writings (<https://ghuntley.com/ralph/> and <https://ghuntley.com/loop/>) informed the fresh-context, one-increment-per-loop, deterministic-stack, backpressure, and outer-harness model. No source code was copied.
