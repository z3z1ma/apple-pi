Type: research
Status: resolved
Blocked by: 05

# How to drive a running Pi session from outside

## Question

What can a separate local process (Agent World's backend) use today to read a live root Pi session's conversation and to send it input, and where would apple-pi need a new channel?

Cover, with sources: the session JSONL format (messages, tool calls and results, custom entries, how fast it is written); the session mailbox (steer semantics, delivery timing for a busy or idle session); tmux `send-keys` into the pane (what the tmux dashboard's reply does, and its limits); Pi's RPC mode and its extension-UI protocol (can a TUI session also expose RPC, or only a process started with `--mode rpc`?); how blocking extension UI such as `ask_user_question` could be answered from outside; interrupting a busy session; and the extension API surface that a new apple-pi channel could build on. The installed Pi package is `@earendil-works/pi-coding-agent` 1.3.0.

## Answer

Findings: [driving a running Pi session](../research/driving-a-running-pi-session.md).

- **Read:** session JSONL gives completed messages, tool calls, tool results, and mailbox steers, but no streaming text; live partial output exists only on the RPC/JSON event stream or inside the session.
- **Send:** the mailbox delivers to any status as a steer (busy: next safe boundary; idle: starts a turn), at least once, with no acknowledgement. `tmux send-keys` types into an idle TUI only, without atomic checks.
- **Not possible from outside a TUI session today:** answering an open `ask_user_question`, a reliable interrupt, streaming text, attaching RPC/socket/HTTP control.
- **Directions for full dialogue:** an apple-pi extension giving each TUI session a local control channel built on the extension API (events, `sendUserMessage`/`sendMessage`, `appendEntry`, `pi.events`), or sessions run in RPC mode under another host, which gives up the tmux TUI as it works now.
