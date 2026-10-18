Type: interrogation
Status: resolved
Blocked by: 04

# The store

## Question

How is the model stored?

The operator chose SQLite in WAL mode with two layers: current-state tables and an append-only event table, with provenance and observed versus desired. Decide the tables, what goes into events versus current state, whether conversation text is stored or referenced from session JSONL, retention, migrations, and where the database lives. Absorbs Agent World's former Persistence ticket (`.ledger/202610171741-guildworld/decisions/10-persistence.md`).

The store also holds apple-pi-owned state that is not about sessions: mailbox messages and their delivery, and UI preferences such as the notch's choices (map Notes, 2026-10-18).

## Answer

Decided with the operator, 2026-10-18.

- **Engine and shape:** one SQLite database in WAL mode, written only by the runtime daemon ([Capture and transport](05-capture-and-transport.md)) through `node:sqlite`, with current-state tables (tmux servers, sessions, windows, and panes; Pi sessions; incarnations; per-session activity; open prompts; relations; work links; seen times; mail; UI preferences) and one append-only event table. Every row carries its source and observation time; commands are kept apart from observations ([Commands back into sessions](07-commands-back-into-sessions.md)). Exact tables are left to the spec.
- **Location:** one file for all apple-pi state, `~/.pi/agent/state/apple-pi.db` (following `PI_CODING_AGENT_DIR`), next to the runtime's socket.
- **Conversation:** index and read through. SQLite indexes each completed message and tool call (session, entry id, role, time, tool, size, short preview); full text is read from Pi's session JSONL by entry id through the runtime, so consumers use one interface without a duplicate copy. Measured 2026-10-18: `~/.pi/agent/sessions` holds 3.2 GB in 1,814 transcripts, and the last 30 days wrote 1.5 GB (about 50 MB a day).
- **Retention:** keep everything for now; set retention only when measured size or speed shows a problem.
- **Schema changes:** a schema version with forward migrations in code, because history, mail, seen times, and preferences cannot be rebuilt from bridges and tmux.
- **Also stored here:** mailbox messages and their delivery (replacing the mailbox JSONL files) and UI preferences such as the notch's choices.
