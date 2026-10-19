# Driving a running Pi session from outside

Research for [How to drive a running Pi session from outside](../decisions/16-driving-a-running-pi-session.md). Read-only scout of the installed Pi 1.3.0 docs (`~/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/`, cited as `pi:docs/…`) and of apple-pi, 2026-10-18. "Not verified" means the evidence inspected does not establish the fact.

## Reading a conversation

- Session JSONL lives at `~/.pi/agent/sessions/--<path>--/<timestamp>_<session-id>.jsonl`; entries link by `id`/`parentId` (`pi:docs/session-format.md:3-14, 49-70`).
- `message` entries hold `user`, `assistant`, and `toolResult` messages; assistant content has `text`, `thinking`, and `toolCall` blocks (`pi:docs/session-format.md:78-92`; `pi:docs/message-types.md:13-63, 109-175`). Extension messages such as mailbox steers are `custom_message` entries (`session-format.md:176-187`; `components/tasks/src/mailbox.ts:84-105`). Compaction, branch summaries, and other entry types also appear (`session-format.md:123-207`).
- **No streaming in the file:** a pending assistant message is not persisted; only completed messages are written (`pi:docs/message-types.md:119-145`). Live partial text exists only as `message_update` events (`text_delta`, `thinking_delta`, `toolcall_delta`) on the JSON/RPC event stream (`pi:docs/json.md:62-99`) or to an extension running inside the session.

## Sending input

| Channel | Busy session | Idle session | Waiting (questionnaire) | Feedback to sender |
| --- | --- | --- | --- | --- |
| Mailbox (`pi-send.mjs`) | steer at the next safe boundary | starts a turn | does not answer it; the steer waits for the next safe boundary, so after the questionnaire closes (not verified) | message id only; at least once; no acknowledgement |
| tmux `send-keys` (dashboard reply) | refused by the dashboard | types text + Enter into the TUI | refused by the dashboard | none beyond local "Sent" |
| RPC (`--mode rpc`) | `prompt` with `streamingBehavior`, `steer` | `prompt` | `extension_ui_response` answers select/confirm/input/editor | command responses and an event stream |

- Mailbox: `pi.sendMessage(…, { deliverAs: "steer", triggerTurn: true })` while running or idle; `nextTurn` at startup; `fs.watch` with a rescan at settle; no bounded latency (`components/tasks/src/mailbox.ts:76-157`; `docs/tasks.md:109-149`).
- Dashboard reply: `tmux send-keys -t <pane> -l -- <text>` then `Enter`, only when the status is `idle`, re-checked just before sending; the check and the keystrokes are not atomic (`components/tmux-sessions/sidebar/dashboard.py:320-348`).
- RPC is a process launched with `--mode rpc` and driven over stdin/stdout (`pi:docs/rpc.md:1-33`; `rpc-commands.md:7-206`). RPC does not support `ctx.ui.custom()` (`rpc-extension-ui.md:12-25`). **Not verified:** any way to attach RPC, a socket, or HTTP to an already-running TUI session. apple-pi publishes only `tui` sessions (`components/tmux-sessions/src/index.ts:162-165`).

## Questionnaires and interrupts

- `ask_user_question` renders a custom TUI dialog in `tui` mode and falls back to sequential `ui.select`/`ui.input` in RPC mode (`components/ask-user-question/src/index.ts:78-107`; `src/rpc.ts:33-109`). **Not verified:** any external way to answer an open TUI questionnaire.
- Interrupt is Escape in the TUI (`dist/core/keybindings.js:12-15`) and `abort` in RPC (`rpc-commands.md:94-128`). The dashboard has no interrupt action. **Not verified:** whether `send-keys Escape` is a reliable interrupt.

## Extension surface for a new channel

An apple-pi extension inside each session can observe lifecycle, message, and tool events (including streaming and `agent_settled`), send messages with `pi.sendUserMessage()`/`pi.sendMessage()` (steer, follow-up, trigger a turn), persist entries with `pi.appendEntry()`, and talk to other extensions over `pi.events` (`pi:docs/extensions.md:62-112`). The SDK's `prompt()`/`abort()` are session methods, not an external API (`pi:docs/sdk.md:60-90`). A per-session control channel would have to be built on these.

## Options and gaps

- Today: read completed messages from JSONL; send text by mailbox (any status, as a steer) or by `send-keys` (idle only).
- Missing for full dialogue: live streaming text outside the session, answering a TUI questionnaire from outside, a reliable interrupt, and any acknowledgement or result for a sent message.
- Two directions exist: an apple-pi extension that gives each TUI session a local control channel (relay events, accept prompts, steers, aborts, and UI answers), or running sessions in RPC mode under a host other than the TUI, which loses the tmux TUI as it works today.
