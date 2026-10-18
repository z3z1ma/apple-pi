# Current state producers and consumers in apple-pi

Research for [Current state producers and consumers in apple-pi](../decisions/03-current-state-producers-and-consumers.md). Read-only scout, 2026-10-18. Extends `.ledger/202610171741-guildworld/research/apple-pi-integration-inventory.md`; citations are `path:lines`.

| Component | Produces | Consumes | Format | Cadence |
| --- | --- | --- | --- | --- |
| tmux-sessions extension | per-session record; close notice by mail | Pi lifecycle events, tmux pane | JSON file per session | on events |
| sidebar, dashboard (`agents.py`) | in-memory roster; `@pi_seen_at`; `@pi_agents` summary | records, tmux panes and clients, session JSONL tail, ledger `history.json` | Python objects; tmux options | polls each second |
| notch | `notch.json`, lock; focus requests | `agents.py feed` (default tmux server only) | JSON lines | each second |
| coordinator skill | ledger threads, briefs, mail | `agents.py list`, mailboxes, ledgers | Markdown, JSONL | at sweeps and on mail |
| mailbox | mailbox JSONL; delivery `custom_message` entries | watcher, session entries | `{id, from, ts, body}` | per send |
| tasks and monitors | in-memory tasks; temp output logs | processes, timers | memory | on events |
| ledger extension | `history.json` `{sessions: [{id, linkedAt, via}]}` | session id, ledger operations, edits | JSON | on operations |
| subagents | child JSONL when persisted; in-memory `AgentRecord` (random id, `parentAgentId`, status, `sessionFile`); output files | parent prompts, child sessions, steers | JSONL, memory | spawn, steer, settle |
| session-title | session name; `session-title` entries | prompts, first settle, ledger results | session entries | event-driven |
| notify | notification log, OS notifications | branch, session id, leaf, tmux pane | JSONL log | settle, question |
| change reflection, forks | reflection message; usage entries | parent snapshot | session entries | after settle |
| notebook | notebook entries; `.pi/LEARNINGS.md` | branch, child sources | session entries, Markdown | tools, compaction |
| pair programmer | in-memory sidecar session | notebook, seed | memory | on invocation |
| input editor | rendered status | footer statuses, branch, usage | memory | render |
| server compaction | compaction entries; in-memory flag | branch, provider payloads | session entries | on compaction |

Key sources: `components/tmux-sessions/sidebar/agents.py:225-397`; `scripts/sidebar.sh:114-138`; `pi_session_manager.tmux:11-33`; `notch/NotchShell.swift:30-232`; `skills/coordinator/SKILL.md:11-68`; `components/tasks/src/mailbox.ts:9-154`; `task-manager.ts:14-340`; `extensions/ledger.ts:33-774`; `components/subagents/src/agent-manager.ts:259-840`, `types.ts:17-88`, `installer.ts:221-1099`; `components/session-title/src/index.ts:9-206`; `components/notify/src/index.ts:20-597`; `components/shared/src/forked-continuation.ts:119-357`; `components/notebook/src/session-ledger/types.ts:1-79`, `shared-notebook.ts:82-345`; `components/pair-programmer/src/session.ts:35-183`; `components/input-editor/src/ui/input-editor.ts:131-411`; `components/server-compaction/src/hooks.ts:20-266`.

## Findings

- **Duplicated derivation:** the sidebar, dashboard, status line, notch, and coordinator all derive "who runs and in what state" from tmux records plus a live tmux check; the sidebar alone adds tool activity (from JSONL) and task titles (from ledger history).
- **Different freshness:** records are event-written; views poll each second; the coordinator checks at sweeps; subagent state lives only in memory.
- **Different liveness rules:** live pid plus matching pane, tty, and server for root sessions; manager records for subagents; nothing for forks and `pi_exec` workers.
- **Different identities:** Pi session id (records, mailbox, ledger, notify), pid plus pane plus socket (liveness), random subagent id plus `parentAgentId`, session id plus agent type (notebook child sources), session id plus leaf id (notify dedupe).
- **Ephemeral by design:** tasks, subagent registry and steers, pair sidecar, fork handles, reflection map, compaction flag.
- **One server only:** the notch reads the default tmux server; no consumer aggregates servers.

## Gaps

No exhaustive JSONL schema; subagent persistence defaults and paths not verified; no repository-wide proof that no other producers exist.
