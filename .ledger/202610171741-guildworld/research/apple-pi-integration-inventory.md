# apple-pi integration inventory

Research for [Apple-pi integration inventory](../decisions/01-apple-pi-integration-inventory.md). Read-only scout of the repository on 2026-10-17; citations are `path:lines` at that date. "Not verified" means the evidence inspected does not establish the fact.

## 1. Tmux state records, `list`, and `feed`

- One JSON file per root `tui` session in tmux at `~/.pi/agent/state/tmux-sessions/<sessionId>.json` (`PI_TMUX_STATE_DIR` overrides). Schema 1 fields: `schema`, `sessionId`, `pid`, `status`, `cwd`, `sessionName`, `paneId`, `windowId`, `paneTty`, `tmuxSocket`, `reportsTo`, `startedAt`, `updatedAt` (`components/tmux-sessions/src/state.ts:16-55`; `docs/tmux-sessions.md:14-32`).
- Writes are temp file + rename; clean shutdown removes the record (`state.ts:67-84`). Initial status `idle` (`src/index.ts:162-203`). Writes are serialized; a status change bumps `updatedAt`, a rename does not (`src/index.ts:137-159, 206-213, 231-238`).
- Status events: `agent_start` → `busy`; `ui_prompt_start` → `waiting`; `ui_prompt_end` → `idle` if idle else `busy`; idle `agent_settled` → `idle`; `session_shutdown` removes (`src/index.ts:241-260`).
- `agents.py list` prints a JSON array: `id`, `name`, `status` (`busy|idle|waiting`), `cwd`, `reportsTo`, `paneId`, `tmuxSession`, `updatedAt` (`sidebar/agents.py:353-367, 396-397`).
- `agents.py feed` prints one JSON array line per second: `id`, `name`, `project`, `state`, `tool`, `detail`, `tmuxSession`, `paneId`, `tmuxSocket`, `updatedAt` (`agents.py:329-350`). `state` is a display state: `waiting`, `done` (idle and unseen), `working` (busy), `quiet` (`agents.py:320-326`).
- Liveness (`live()`, `agents.py:238-285`): tmux `list-panes -a` and `list-clients`, then the state directory. A record counts only when its pid is alive and its pane id exists with a matching tty. Dead-pid records are deleted; records naming this server with a missing pane are deleted; records from other servers are skipped.
- Both commands cover only the **current tmux server** (`docs/tmux-sessions.md:46-48, 60-64`). The notch unsets `TMUX`/`TMUX_PANE`, so it reads the default server (`scripts/notch.sh:36-39`).

## 2. Per-agent facts the sidebar and dashboard derive

`AgentStore.poll()` refreshes every second: live agents, incremental JSONL read, ledger task lookup (`agents.py:210-235`; `sidebar.py:39-40`; `dashboard.py:28-32`).

- **Last tool call and detail:** last assistant `toolCall` part's `name`; detail is the first non-empty string among `command`, `path`, `pattern`, `query`, `description`, `task`, `name`, `code`, first line, `~` for home, leading `cd … && ` stripped (`agents.py:100-119, 158-174`).
- **Ledger task:** nearest `.ledger/` at or above cwd; scan `*/history.json` for the session id; latest `linkedAt` wins; title from the first `# ` line and status from `Status:` in `task.md` (`agents.py:177-203`; `docs/ledger.md:55-71`).
- **Name:** session name, else ledger task title, else cwd basename (`agents.py:75-89`).
- **Cost, context size, model:** sums `usage.cost.total`; context size and model from the latest assistant message (`agents.py:151-166`).
- **Tool-call graph:** tool-call timestamps binned per minute over 30 minutes (`agents.py:91-97, 166-174`).
- **Session log:** `<PI_CODING_AGENT_DIR or ~/.pi/agent>/sessions/*/*_<sessionId>.jsonl`, last match, read incrementally (`agents.py:16-20, 122-149, 216-223`).
- **Seen:** tmux pane option `@pi_seen_at`; an agent needs attention when `waiting`, or idle with `updatedAt` after seen (`agents.py:20-21, 80-81, 206-207, 296-303`).
- **Dashboard preview:** `capture-pane` of the selected agent, only while shown (`dashboard.py:260-299`).

## 3. Session mailbox

- Address is a Pi session id; file `<agent dir>/state/mailbox/<id>.jsonl` (`PI_MAILBOX_DIR` overrides); id pattern `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$` (`components/tasks/src/mailbox.ts:9-21`; `docs/tasks.md:111-113`).
- Line format `{id, from, ts, body}`: UUID, sender label, ISO time, text (`mailbox.ts:23-29`).
- `mailbox_send` sets `from` to the caller's session id and returns the message id; it says when the receiver is not running (`mailbox-tool.ts:10-31`).
- `pi-send.mjs <id> [--from <label>] <message>` lets any process send; default `from` is `shell` (`scripts/pi-send.mjs:10-35`).
- Delivery is **at least once**; the id identifies a repeat (`docs/tasks.md:143-149`; `mailbox.ts:32-157`).
- **No acknowledgement.** The sender gets the appended id, not processing status. A Pi receiver can reply only by mailing the sender's `from` label; nothing reads that mailbox unless a Pi session with that id opens. A non-Pi process has no registered mailbox.

## 4. Coordinator

- Start: `tmux new-window -d -n <name> -c <dir> "pi --session-id <id> --name <name> --reports-to <coordinator id> @<brief>"`; reopen without the brief (`skills/coordinator/SKILL.md:26-35, 56`).
- Close notice: on shutdown (not reload) a worker with `--reports-to` mails its supervisor `Session "<name>" closed (<reason>) while <status>. Directory: <cwd>`; append errors are swallowed (`src/index.ts:115-135, 261-267`). Crash, SIGKILL, or power loss sends none (`docs/tmux-sessions.md:52-58`).
- Coordinator threads are ledger tasks in its home. **Not verified:** any machine-readable thread-status contract beyond ledger files and `agents.py list`.

## 5. Browser pages server

- Listens on `127.0.0.1:0`; URL carries the token as `?t=` (`components/browser-pages/src/page-server.ts:144-152`).
- Exact loopback host/port required; `GET /` needs `t`, other routes need `x-page-token` (`page-server.ts:108-130`).
- Opened with `open`/`xdg-open`; any local app with the URL can use it (`index.ts:55-58`; `docs/browser-pages.md:161-165`).
- Lifetime: one page session; reviews close after one submission, explanations at session end (`page-server.ts:56-68, 133-152`). Not a persistent feed.

## 6. Notch panel

- Each new root tmux Pi on macOS runs `scripts/notch.sh start`, which compiles `NotchShell.swift` once per source hash into `~/.pi/agent/cache/notch/` and starts it (`src/index.ts:183-185`; `notch.sh:16-39`).
- The shell loads `notch/web/index.html` in WKWebView, injects geometry and saved choices, and registers the `notch` message handler (`NotchShell.swift:76-86`).
- It runs `uv run --no-project python agents.py feed` and calls `window.notch.update(<json>)` per line; restarts a dead feed after 1 s (`NotchShell.swift:145-176`).
- Clicks post pane id, tmux session, and socket back to Swift (`notch/web/index.html:283-298`; `NotchShell.swift:118-143`).
- Exclusive lock `state/notch.lock`; choices in `state/notch.json` (`NotchShell.swift:30-44, 180-232`).

## 7. Jira, Slack, Confluence, GitHub

- Pi owns MCP: config in `~/.pi/agent/mcp.json` and trusted `.pi/mcp.json`, OAuth in `~/.pi/agent/mcp-auth.json`; tools are `mcp__<server>__<tool>` (`docs/mcp.md:3-8, 23-56, 69-73`).
- This session shows Atlassian (Jira and Confluence), Slack, and Wispr Flow MCP servers deferred behind `tool_search`; which servers an operator configures is user-global and **not verified** from the repository.
- `gh` appears only as an example command (`docs/tasks.md:60-66`).
- **Not verified:** any way for a non-Pi process to reuse Pi's live MCP connections or OAuth tokens.

## 8. Session JSONL

- `~/.pi/agent/sessions/--<cwd>--/*.jsonl` (`docs/context.md:90-98`).
- Fields the sidebar relies on: entry `type`, `timestamp`; `message.role`, `model`, `usage.totalTokens`, `usage.cost.total`, `content` parts with `type: "toolCall"`, `name`, `arguments`; top-level `usage` entries (`agents.py:151-174`).
- **Not verified:** a complete versioned schema of every entry type.

## Gaps

1. No feed aggregates agents across tmux servers; `list` and `feed` cover one server.
2. Subagents and `pi_exec` workers publish nothing.
3. Mailbox has no acknowledgement, and a non-Pi process cannot receive mail.
4. No machine-readable coordinator thread status.
5. SaaS access lives inside Pi (MCP OAuth); no documented external reuse.
6. Browser pages are per-review token servers, not a long-lived status service.
7. No versioned session JSONL schema; the sidebar reads a subset.
