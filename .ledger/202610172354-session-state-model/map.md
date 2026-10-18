# Shared Pi and tmux state model map

## Destination

A spec for one rich state model of the operator's Pi sessions, tmux, and processes, ready for `/skill:to-spec`: what is captured (entities, bindings, activity, conversation, attention), how it is captured (a bridge extension in every Pi session plus tmux and process observation), how it is stored (SQLite), which commands flow back, and how it replaces apple-pi's existing runtime state as the one foundation every consumer uses (sidebar, dashboard, status line, notch, mailbox, coordinator, Agent World).

## Notes

- Origin: the Agent World map (`.ledger/202610171741-guildworld/map.md`). The operator decided on 2026-10-18 that a maximally rich, solid state model comes first, and that its improvement should percolate through all of apple-pi so every consumer uses the same best representation. Agent World and every other view is first a projection of this state and second an interface for sending actions back to the real processes.
- Replacement, not a bolt-on (operator, 2026-10-18): the model replaces the guts of apple-pi's existing runtime state and becomes the uniform foundation for current features (sidebar, dashboard, status line, notch, mailbox, coordinator) and future ones (Agent World). Boundary: apple-pi-owned runtime state moves into the model, including tmux session records, `agents.py` list and feed derivations, `@pi_seen_at` and the `@pi_agents` summary, mailbox storage, the subagent registry, the notch feed, coordinator worker tracking, and UI preferences such as the notch's `notch.json`. Pi-owned data (session JSONL, settings, auth) and project files (ledger bundles and `history.json`, the wiki, `.pi/LEARNINGS.md`) stay where they are; the model indexes or mirrors them. Cut-over is a clean switch: one change moves every producer and consumer, and old files and `agents.py` commands are deleted, with no compatibility layer.
- Decided before charting (operator, 2026-10-18): capture through a bridge extension in every Pi session (events out, commands in), with tmux and process observation alongside; store in SQLite (WAL) with two layers, current-state tables plus an append-only event table, with provenance and observed versus desired. No separate deterministic orchestrator service: the coordinator session remains the orchestrator.
- The operator's must-capture list: everything each Pi session is doing; bindings between Pi sessions; semantic bindings (today `reportsTo`); the binding of a Pi session to a tmux pane and a process id.
- The model never invents state: observed facts carry their source; settled is not done; sent is not acknowledged.
- Existing evidence: `.ledger/202610171741-guildworld/research/apple-pi-integration-inventory.md` and `.ledger/202610171741-guildworld/research/driving-a-running-pi-session.md`.
- Skills: `research` for research tickets; `interrogate-to-design` and `domain-modeling` for interrogation tickets. Record resolved terms in the harness glossary (`.wiki/pages/domain-language.md`).
- No execution scope is approved. This map produces decisions only.

## Decisions so far

- [What a Pi extension can observe and control](decisions/01-what-a-pi-extension-can-observe-and-control.md): an in-session bridge sees lifecycle, streaming, tool calls, usage, and lineage and can send, steer, follow up, and abort; it cannot answer another extension's open dialog, see retries as events, or see subagent and worker events without help from those components.
- [What tmux and macOS expose for binding sessions to panes and processes](decisions/02-what-tmux-and-the-os-expose.md): pane keys are socket path plus `%pane`; Pi is a child of the pane's shell; tmux hooks and control mode stream changes; a full `tmux list-panes` plus `ps -A` scan costs about 30 ms.
- [Current state producers and consumers in apple-pi](decisions/03-current-state-producers-and-consumers.md): five consumers re-derive the same live view with different freshness, liveness rules, and identities; subagent, task, and fork state lives only in memory; nothing spans several tmux servers.
- [The state model](decisions/04-the-state-model.md): capture everything observable; tmux servers to panes, sessions (root and interactive child) with incarnations, rich per-session activity, completed conversation, supervision, parentage, lineage, mail, and work links over time; per-session seen time; events for all but streaming and tool progress; liveness from the bridge, then the process.
- [Capture and transport](decisions/05-capture-and-transport.md): one Node runtime daemon per Mac, started on demand and staying up, sole writer to `node:sqlite`; a Unix socket with JSON lines for bridges and for changes from views (views read the database directly, see Consumers and migration); a bridge in every root and child session; tmux polled each second; snapshot plus gap on reconnect; session-to-ledger-task links observed over time.
- [The store](decisions/06-the-store.md): one WAL SQLite file, `~/.pi/agent/state/apple-pi.db`, written only by the runtime: current-state tables plus an append-only event table, mail, and UI preferences; conversation indexed in SQLite and read through from Pi's JSONL; keep everything for now; versioned forward migrations.
- [Commands back into sessions](decisions/07-commands-back-into-sessions.md): talk, steer, follow-up, answer, abort, mark seen, mail, start, reopen, close, rename, and model changes; staged receipts (accepted, delivered, applied, failed), never "done"; only mail waits for a stopped session; `ask_user_question` answerable from the terminal or the runtime, first wins.
- [Consumers and migration](decisions/08-consumers-and-migration.md): views read the SQLite file directly and send changes over the socket; the runtime drives tmux (status line, seen from the shown pane, jump target); every root session gets mail and peer-discovery tools through its bridge, and a coordinator extension adds only starting, reopening, and closing sessions; in-session views unchanged; old records, `agents.py`, the focus hook, mailbox files, and `notch.json` are deleted.

## Not yet specified

Nothing remains.

## Out of scope

- How any consumer presents the state (Agent World's world, themes, art; the sidebar's and notch's look).
- External systems (Jira, GitHub, Confluence, Slack): they belong to Agent World's map.
- A separate deterministic orchestrator service (rejected by the operator, 2026-10-18).
- Decisions the spec and build own rather than this map: the testing approach (fixtures for Pi events, tmux, and processes) and the performance budget, which is measured once the runtime exists instead of guessed now (repository rule: no arbitrary caps without evidence).
