Type: interrogation
Status: resolved
Blocked by: 01, 02, 03

# The state model

## Question

Which entities, bindings, activity dimensions, conversation records, and attention facts make up the shared state model?

Start from the operator's list: everything each Pi session is doing; bindings between Pi sessions (supervision through `reportsTo`, subagent parentage, fork lineage, mailbox messages); semantic bindings (ledger tasks, coordinator threads); and the binding of a Pi session to its tmux pane, process, and incarnation. Decide identities and keys, the orthogonal activity dimensions (process, run state, current tool, open questionnaire, queue, usage, errors), what is observed versus desired, what counts as an event, and what the model must never invent.

## Answer

Decided with the operator, 2026-10-18. Terms are in the harness glossary (`.wiki/pages/domain-language.md`, "Session state").

- **Principle:** capture as much as the bridge and tmux can observe; the model is limited only by what can be captured.
- **tmux topology:** every live tmux server (keyed by socket path) and every session, window, and pane in it, including panes without Pi.
- **Session:** one Pi session by session id: every root session, in tmux or not, and every interactive child session (subagent), linked to its parent. `pi_exec` workers and forked continuations are not modelled.
- **Incarnation:** one process lifetime of a session (pid, start time, generation number), bound to one pane when in tmux. Reopening creates a new incarnation, possibly in another pane. A child session's incarnation is its parent's process.
- **Per-session facts:** process state (starting, alive, alive with bridge lost, exited, lost); run state (idle, thinking, writing a reply, running a tool, compacting); current tool (name, main argument, since); open prompt (kind, title, and a questionnaire's questions); queue (steers, follow-ups, undelivered mail); last error and abort; model, thinking level, context use, cost; configuration (name, flags, active tools, extensions, skills, MCP servers); completed conversation (messages, tool calls, results), with no live streaming text.
- **Relations:** supervision (`reportsTo`); parentage (interactive child session to parent); lineage (fork or clone through Pi's `parentSession`, and resume or switch within a pane); mail (from, to, sent, delivered); work links (time-stamped links between a session and the ledger tasks it works on, and the git repository, branch, and worktree of the cwd). The coordinator-thread convention first chosen here was replaced in [Capture and transport](05-capture-and-transport.md) by observed session-to-ledger-task links over time.
- **Attention:** the model stores when the operator last saw each session; any view can mark it seen. Needs you = an open prompt, or a new reply since last seen. This replaces tmux's `@pi_seen_at`.
- **Events:** every lifecycle, turn, completed message, tool start and end, prompt, model, compaction, mail, tmux, and process change is an event. Streaming text and tool progress only refresh current state.
- **Liveness:** an incarnation is alive while its bridge is connected and heartbeating; when the bridge goes silent, a process check (pid plus start time) decides between "alive, bridge lost" and "exited or lost". Never inferred from tmux alone.
- **Honesty:** every fact carries its source and time; commands are recorded apart from observations; settled is not done; sent is not delivered.
- **Handed off:** how child-session events reach the runtime ([Capture and transport](05-capture-and-transport.md)); how conversation text is stored ([The store](06-the-store.md)).
