Type: interrogation
Status: resolved
Blocked by: 01, 05

# Agent facts shown

## Question

Which facts about an agent does Agent World show as observed, beyond `busy`/`idle`/`waiting`, and does apple-pi need to publish more?

The sidebar already derives last tool call, ledger task, cost, and context size. Decide which of these Agent World shows, which activity labels it may infer (for example "researching"), and whether a new published field or event is worth a change to apple-pi.

## Answer

Decided with the operator, 2026-10-18.

- **Inspector (observed facts):** name; status and time in it; linked ledger task (title and status); tmux location; directory; who it reports to; last tool call with its main argument; the 30-minute tool-call graph; cost, context size, and model. No live pane view.
- **Animation:** a character's animation may follow its last tool call (for example editing, reading, or running a command). The tool name is observed; the animation is decorative; the inspector shows the real call.
- **No inferred labels** such as "researching" or "reviewing". The world has no inferred truth class.
- **Seen is shared with tmux:** inspecting a character for about three seconds stamps the same `@pi_seen_at` pane option the sidebar and dashboard use, so every view agrees on who needs you.
- **apple-pi publishes nothing new** for these facts: Agent World reads the sources the sidebar reads (tmux state records, session JSONL, `.ledger/*/history.json`).
- **Conversation text** is not a fact for the inspector. The operator wants rich dialogue with characters so the terminal becomes optional; that moved to [Dialogue with a character](17-dialogue-with-a-character.md), informed by [How to drive a running Pi session from outside](16-driving-a-running-pi-session.md).
- **Reopened in part (2026-10-18):** the operator chose a bridge extension in every Pi session as the source of rich state, so "apple-pi publishes nothing new" no longer holds. Which facts exist is now decided in the shared state model task (`.ledger/202610172354-session-state-model/`); the inspector choices here stand.
