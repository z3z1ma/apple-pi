Type: research
Status: resolved
Blocked by: 

# Apple-pi integration inventory

## Question

What does apple-pi already provide that Agent World can read or call, and where are the gaps?

Cover, with file paths and exact shapes: the tmux state records and `agents.py list` / `feed` (fields, liveness rules, multiple tmux servers); per-agent facts the sidebar and dashboard already derive (last tool call, ledger task from `.ledger/*/history.json`, cost and context from session JSONL); the session mailbox (`mailbox_send`, `pi-send.mjs`, on-disk format, delivery and any acknowledgement); coordinator worker start, reopen, and close notices; the browser-pages token server (`components/browser-pages/src/page-server.ts`): binding, auth, lifetime; the notch shell (`NotchShell.swift` + `notch/web/`): how a WKWebView page gets its data; and how a Pi session reaches Jira, Slack, Confluence, and GitHub today (MCP servers, `gh`).

The answer feeds the ontology, agent facts, SaaS source, delegation, and runtime decisions. Facts only; no recommendations needed.

## Answer

Findings: [apple-pi integration inventory](../research/apple-pi-integration-inventory.md).

- Readable today: per-session tmux records and `agents.py list`/`feed` (status, name, project, last tool, pane, supervisor), with correct liveness, for one tmux server at a time; ledger task, cost, context size, and a 30-minute tool graph derived from session JSONL and `.ledger/*/history.json`.
- Callable today: `pi-send.mjs` and `mailbox_send` append to a session mailbox, at least once, with no acknowledgement; coordinator workers start and reopen through `tmux new-window "pi --session-id … --reports-to …"` and mail a close notice.
- Precedents: the notch is a Swift WKWebView fed by `agents.py feed`; browser pages are per-review token servers on 127.0.0.1.
- Gaps: no cross-server feed, no subagent visibility, no mailbox for a non-Pi process and no acknowledgement, no machine-readable coordinator thread status, SaaS access only inside Pi through MCP OAuth, no versioned session JSONL schema.
