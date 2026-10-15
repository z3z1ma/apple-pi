Status: planning
Created: 2026-10-14
Updated: 2026-10-14

# Code context sidecars with read injection and block-and-retry edit gate

## Intent

Store non-derivable architectural knowledge (invariants, hazards, couplings, rationale) in Markdown sidecars under the project root's `.context/` directory, mirroring the source tree (`app/main.py` → `.context/app/main.py.md`), and deliver it when the agent works on the file:

- A top-level `read` of a covered file or its sidecar appends the whole sidecar and one `<context-ref path="…" hash="sha256:…" />` marker, unless that exact marker is already live in the effective context.
- A top-level `edit`/`write` of a covered file is blocked until the current marker is live; the block tells the agent to `read` first.
- `context_lint` checks sidecar structure and references.
- Change reflection and `/distill` keep sidecars current and surface changed invariants.

Source brief: the operator's "Code Context Sidecars with Block-and-Retry Awareness Gate" implementation brief (session of 2026-10-14).

## Phase 0 findings

- **Effective context (A).** `ctx.sessionManager.buildSessionProjection().messages` is the compaction-aware, branch-following, model-visible message list (`ReadonlySessionManager` exposes it; `components/subagents/src/clarify.ts` already uses it). Compaction drops entries before `firstKeptEntryId`; server compaction uses the same entry shape.
- **Forks.** A forked continuation (`components/shared/src/forked-continuation.ts`) runs its tools through the parent's hooks, so `ctx.sessionManager` is the *parent's*. A fork's own reads would never satisfy the gate. The fork scope must expose the fork's live messages to tool hooks.
- **pi_exec isolation (B).** Nested calls through `ctx.executeTool()` reach `tool_call`/`tool_result` with `parentToolCallId` set; inactive core tools in `pi_exec` bypass hooks entirely. Skipping events with `parentToolCallId` keeps program reads raw and program mutations ungated.
- Markers count only inside `read`/`edit`/`write` tool results, so a compaction summary or assistant text that quotes a marker cannot fake delivery.

## Acceptance criteria

- Sidecars are discovered and hashed deterministically (CRLF→LF, trailing whitespace trimmed, SHA-256).
- Full or windowed top-level `read` of a covered file or its sidecar appends the full sidecar and marker once while the marker stays live.
- Top-level `edit`/`write` on a covered file fails with the read directive when the marker is absent or stale, and succeeds after a read.
- Editing a sidecar changes its hash; the old marker no longer counts; a sidecar mutation result carries the new marker.
- Compaction that removes the marker and forks evaluate their own context.
- `pi_exec` nested reads return raw content.
- Unreadable or empty sidecars fail open with a diagnostic.
- `context_lint` reports orphaned sidecars, invalid and duplicate headings, missing symbol anchors, broken `Coupled:`/`Verify:` paths, and broken `[[wiki-links]]`.
- Change reflection and `/distill` prompts ask for sidecar upkeep and explicit reporting of changed invariants.
- Format, lint, typecheck, tests, loader, and pack checks pass.

## Decisions

- Operator changed the layout (2026-10-15): sidecars live in a mirrored `.context/` tree as `<path>.md`, not as `<file>.context` beside the source. The project root is the nearest Git worktree root of the working directory, else the working directory; `context_lint` walks `.context/` instead of `git ls-files`.
- Operator chose: load in root sessions, ordinary children, and `pi_exec` workers; change reflection may start sidecars in any repository; Phase 5 evaluation moved to `.ledger/202610150034-code-context-evaluation/`.
- Markers count only inside `read`/`edit`/`write` tool results.
- A whole `read` of the sidecar appends only the marker; a windowed one appends the full block.
- Sidecars are `.md`, so they get change reflection's prose lens; the code lens carries sidecar upkeep and the `Changed invariant:` report.

## Current State

Phases 0–4 implemented; layout moved to `.context/<path>.md` on 2026-10-15. After the move: format, lint, typecheck, pair, loader, pack pass; two full unit runs each failed one different timing test (`pi-exec-work-panel` 5 s timeout, `pi-exec` evidence test), both pass alone. Earlier: Format, lint, typecheck, pair, loader, pack, and the touched suites pass. No full unit run has exited clean since the child/worker wiring: three runs each failed one different timing test (`tasks` scheduled command, `tmux-sessions` temp cleanup, `pi-exec-work-panel` 5 s timeout), each of which passes alone. The pre-change commit `aff1140` shows the same kind of flakes (1 and 4 failures in two full runs), so they predate this work.

## Outcome

- `components/code-context/` (resolver, lint, installer), `extensions/code-context.ts`, `docs/code-context.md`.
- `forkMessages()` in `components/shared/src/fork-context.ts` exposes a fork's own conversation to tool hooks.
- `wikiPageExists()` in `components/wiki/src/graph.ts` serves `context_lint`.
- `components/shared/src/tool-path.ts` duplicates `resolveToolPath` in `extensions/ledger.ts`; switch the ledger to it once that file's in-flight work lands.
- Not proven: behavior with a real model (does the agent replan after a block?). That is the evaluation task.
