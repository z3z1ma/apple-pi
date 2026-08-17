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
- Local path: `components/vcc/`; integration in `extensions/context.ts`
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

## pi-mcp-adapter (runtime dependency)

- Source: <https://github.com/nicobailon/pi-mcp-adapter>
- Reviewed commit: `5ee81b47b571b3c4ac2e68a03812c64e3f95cb98`
- Pinned npm version: `2.26.0`
- Author named by the source package: Nico Bailon
- Integration path: `extensions/mcp.ts`
- License: MIT
- Original notice: `Copyright (c) 2026 Nico Bailon`
- Boundary: the upstream package is installed as a normal npm dependency; its source is not copied into apple-pi. apple-pi suppresses only the duplicate `mcpScript` tool at registration and exposes the adapter's `mcp` gateway to ordinary Pi turns and `pi_exec`. The dependency retains ownership of MCP transports, protocol negotiation, lifecycle, OAuth/keyring storage, approvals, output guarding, prompts/resources, and MCP UI behavior.

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
