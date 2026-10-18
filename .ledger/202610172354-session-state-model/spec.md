# Spec: the shared Pi and tmux state model

Source: the cleared map in [map.md](map.md) and its resolved tickets in [decisions/](decisions/). Research is in [research/](research/).

## Problem Statement

The operator runs many Pi sessions in tmux at once, some started and supervised by a coordinator (a Pi session running the `coordinator` skill, which keeps the operator's threads and starts worker sessions), some started by hand, some started by other sessions. Apple-pi already shows them in a sidebar, a dashboard, the tmux status line, and the notch (a small macOS panel under the MacBook notch), and sessions can mail each other. But every one of those features keeps its own partial, file-based picture of the same reality:

- Five consumers (sidebar, dashboard, status line, notch, coordinator) each re-derive "who is running and in what state" from per-session JSON records plus a live tmux check, with different freshness, liveness rules, and identities.
- The picture is thin: three statuses (`busy`, `idle`, `waiting`), a last tool call, and a few names. A questionnaire's questions, the queue, errors, subagents, lineage between sessions, and which work a session is on over time are not captured at all.
- Seen state lives in tmux pane options, mail in JSONL files, notch choices in their own JSON file, and subagent state only in memory.
- Nothing outside a session can answer its questionnaire, interrupt it reliably, or learn whether a sent message was received.

Every planned feature, starting with Agent World (a themeable world app that shows sessions as characters; ledger task `202610171741-guildworld`), needs one rich, trustworthy account of what each session is doing and how sessions, panes, processes, and work relate, plus a dependable way to act on sessions from outside the terminal.

## Solution

One shared session state model replaces apple-pi's runtime state and becomes the foundation every feature uses.

- A **bridge** extension runs in every Pi session, root and interactive child, reports everything the session can observe, and carries commands back into it.
- One **runtime** daemon per Mac receives the bridges' reports over a local socket, follows tmux and processes, and is the only writer to one SQLite database. It starts on demand and stays up.
- The database holds current state (tmux down to panes, sessions and their incarnations, rich activity, relations, work links over time, attention, mail, preferences) plus an append-only event history, and indexes each session's conversation, whose full text stays in Pi's own transcripts.
- Views read the database directly; anything that changes state, from marking a session seen to steering it or answering its questionnaire, is a command sent over the socket with staged receipts.
- The sidebar, dashboard, status line, jump key, notch, mailbox, and coordinator move onto the model in one clean switch; the old records, `agents.py`, the focus hook, the mailbox files, and `notch.json` are deleted.

## User Stories

### Seeing what runs

1. As the operator, I want every root Pi session on my Mac to appear in one shared model, whether or not it runs in tmux, so that no session is invisible to my tools.
2. As the operator, I want every subagent (interactive child session) to appear linked to the session that started it, so that I can see delegated work, not only top-level sessions.
3. As the operator, I want every tmux server, session, window, and pane on my Mac in the model, including panes without Pi, so that views can show where each session lives among my other work.
4. As the operator, I want a session to keep the same identity when I reopen it, while each process lifetime is recorded as its own incarnation, so that history follows the session and stale processes cannot be confused with live ones.
5. As the operator, I want to see whether a session's process is starting, alive, alive but no longer reporting, exited, or lost, so that I never mistake a crashed session for an idle one.
6. As the operator, I want to see a session's run state (idle, thinking, writing a reply, running a tool, compacting), so that I know what it is doing right now, not only whether it is busy.
7. As the operator, I want to see the tool a session is running, its main argument, and since when, so that I can tell a long build from a stuck command.
8. As the operator, I want to see an open prompt's kind and title, and a questionnaire's actual questions, so that I can decide whether to answer without opening the pane.
9. As the operator, I want to see queued steers, follow-ups, and undelivered mail for a session, so that I know what it will do next.
10. As the operator, I want to see a session's last error and whether its last run was aborted, so that failures are visible.
11. As the operator, I want to see each session's model, thinking level, context use, and cost, so that I can manage spend and context pressure.
12. As the operator, I want each session's configuration (name, flags, active tools, extensions, skills, MCP servers) captured, so that I can tell how a session was set up.
13. As the operator, I want each session's completed conversation (messages, tool calls, results) readable through the model, so that views can show what an agent said without the terminal.
14. As the operator, I want the model to capture everything a session can observe, so that future views are limited only by what Pi exposes, not by what an earlier design chose to keep.

### Relations and work

15. As the operator, I want to see which sessions report to which coordinator, so that supervision is explicit.
16. As the operator, I want to see which session a subagent belongs to, so that I can trace delegated work to its owner.
17. As the operator, I want to see which session another was forked or cloned from, and which sessions followed each other in one pane, so that I can follow a line of work across restarts and branches.
18. As the operator, I want mail between sessions recorded with sender, receiver, send time, and delivery into the receiver's session, so that I can see who asked whom for what and whether it arrived.
19. As the operator, I want each time a session creates, changes the status of, or edits a ledger task recorded as a time-stamped link, so that I can see what a session is working on now and what it worked on before.
20. As the operator, I want a session that was mailed work without a ledger task to show "no linked task" until one appears, so that the model never guesses.
21. As the operator, I want each session's git repository, branch, and worktree recorded, so that views can connect a session to its code.

### Attention

22. As the operator, I want the model to know when I last saw each session, so that every view agrees on what is new to me.
23. As the operator, I want a session marked seen when its pane is the one my tmux client shows, so that looking at a session in tmux counts without any extra action.
24. As the operator, I want any view to be able to mark a session seen, so that reading it in the sidebar, notch, or Agent World counts too.
25. As the operator, I want "needs you" to mean an open prompt or a new reply since I last looked, so that the attention signal is precise.

### Acting on sessions

26. As the operator, I want to talk to an idle session from a view, so that I can give it its next instruction without the terminal.
27. As the operator, I want to steer a busy session from a view, so that I can redirect it mid-run.
28. As the operator, I want to queue a follow-up for a busy session from a view, so that it acts after the current run without being interrupted.
29. As the operator, I want to answer a session's questionnaire from either the terminal or a view, whichever I reach first, with the other side closing, so that a question never blocks on where I happen to be.
30. As the operator, I want to abort a session's run from a view, so that I can stop runaway work.
31. As the operator, I want to rename a session and change its model or thinking level from a view, so that I can manage it without the terminal.
32. As the operator, I want to start a new session in a tmux window, reopen a stopped one, or close one from a view, so that the session lifecycle is manageable from anywhere.
33. As the operator, I want every command to report its stages (accepted, delivered, applied, or failed with a reason), so that I know how far it got and never see "done" for something only sent.
34. As the operator, I want a command to a session that is not running to fail at once with "not running", except mail, so that I am not misled into thinking it will happen.
35. As the operator, I want a command addressed to one incarnation never to reach a later one, so that an old instruction cannot hit a restarted session.
36. As the operator, I want a retried command to apply only once, so that a flaky connection never doubles an instruction.

### Sessions working together

37. As a Pi session, I want to discover the live peer sessions on the machine (id, name, directory, status, who each reports to, current ledger task), so that I can find the right session to work with.
38. As a Pi session, I want to mail any peer session, so that sessions can coordinate and self-organize with or without a coordinator.
39. As a Pi session, I want mail sent to a stopped session to wait and arrive when it next opens, so that messages are not lost.
40. As a Pi session, I want tool descriptions that keep peer sessions (separate, long-lived Pi sessions reached by mail) distinct from my subagents (children I start and own), so that I pick the right mechanism.
41. As a worker session started with `--reports-to`, I want my supervisor mailed when I close, as today, so that it learns I stopped.
42. As the coordinator session, I want tools to start, reopen, and close sessions that go through my bridge with receipts, so that every worker start is recorded and confirmed instead of being a raw tmux command.
43. As the coordinator session, I want to see which of my workers run, what each is doing, and what work each is linked to, so that my sweeps rest on the model instead of separate checks.
44. As an outside process (for example a launchd job), I want to send mail through `pi-send.mjs`, now as a command to the runtime, so that existing external senders keep working.

### Views

45. As the operator, I want the sidebar and dashboard to read the shared model, so that they show the richer facts and agree with every other view.
46. As the operator, I want the tmux status-line summary written by the runtime whenever state changes, so that it is always current without the views polling for it.
47. As the operator, I want the jump key to take me to the session that has needed me longest, using a target the runtime keeps up to date, so that jumping is instant.
48. As the operator, I want a reply typed in the dashboard to reach the session as a talk command, so that replies are delivered and acknowledged rather than typed into a pane.
49. As the operator, I want the notch to read the shared model and keep its choices in it, so that it uses the same state as everything else.
50. As the operator, I want `/pi-sessions` to list sessions from the model, so that the confirmation command reflects the new foundation.
51. As a future Agent World, I want to read the same database and send the same commands from Electron's main process, so that the world is a projection of the shared state, not a parallel copy.
52. As the operator, I want the views inside a Pi session (the `/work` panel, the input editor) to keep reading their own process's state, so that they stay instant.

### Reliability and honesty

53. As the operator, I want the runtime started automatically by the first session or view that needs it and kept running after sessions end, so that I never manage a daemon by hand.
54. As the operator, I want a session to keep working while the runtime is down, and to report its full current state when it reconnects, so that an outage loses history but never corrupts the present.
55. As the operator, I want a gap recorded when events were missed, so that history never pretends to be complete.
56. As the operator, I want liveness decided by the bridge's connection first and a process check second, never by tmux alone, so that a reused pid or a leftover pane cannot keep a dead session alive.
57. As the operator, I want every fact to carry its source and time, and commands kept apart from observations, so that I can always tell what was seen from what was asked.
58. As the operator, I want the full event history kept until measured size or speed shows a problem, so that nothing is thrown away on a guess.
59. As the operator, I want schema upgrades to migrate the database forward, so that history, mail, seen times, and preferences survive updates.
60. As the operator, I want all sessions on all my tmux servers in one model, so that a second tmux server is not a blind spot.

### Maintaining apple-pi

61. As a maintainer, I want one state model instead of five derivations, so that a new feature reads one place and every view stays consistent.
62. As a maintainer, I want the switch done in one change with the old formats deleted, so that there is no compatibility layer to maintain.
63. As a maintainer, I want the runtime to use Node's built-in SQLite, so that installing apple-pi needs no native build.
64. As a maintainer, I want the state model's terms in the harness glossary, so that code, docs, and conversation use the same words.

## Implementation Decisions

### Modules

- **Bridge extension.** Loaded in every root session and, by explicit path like other child extensions, in every interactive child session. Reports the session's identity (session id, session file, `parentSession`, pid, `TMUX`/`TMUX_PANE`, `--reports-to`, cwd, git repository, branch, worktree), configuration, lifecycle, turns, completed messages, tool starts and ends, prompts (a questionnaire's questions come from `ask_user_question`'s call arguments), model and thinking changes, compaction, usage, queue state, errors, aborts, and ledger links. Keeps working when the runtime is down; on reconnect sends its full current state. Delivers commands into the session with Pi's extension API (`sendUserMessage` and `sendMessage` with steer, follow-up, and next-turn delivery; `ctx.abort()`; session name, model, and thinking-level setters). A child session connects on its own and names its parent; its incarnation is the parent's process.
- **Runtime daemon.** One Node process per Mac. Owns the database as its only writer (`node:sqlite`, WAL). Listens on a Unix domain socket under `~/.pi/agent/state` (following `PI_CODING_AGENT_DIR`), protected by file permissions, speaking newline-delimited JSON both ways. Started on demand by the first bridge or view that finds none; a single instance is guarded by its socket and a lock; stays running after sessions end. Polls `tmux list-panes -a` (and `list-clients`) on every live tmux server once a second; scans processes only when a bridge goes silent. Writes the status-line summary and the jump target into tmux when state changes, and marks a session seen when its pane is shown by a client.
- **Schema and migrations.** A schema version and forward migrations, shared by the runtime and by test fixtures.
- **Peer tools for every root session.** The existing mail tool (`mailbox_send`) now sends a mail command through the session's bridge; a new discovery tool lists live peer sessions from the model. Tool descriptions distinguish peer sessions from subagents.
- **Coordinator extension.** Loaded by the coordinator session; adds tools to start, reopen, and close sessions through that session's bridge. The `coordinator` skill uses them instead of raw `tmux new-window` and `agents.py list`.
- **`ask_user_question` change.** The tool publishes its open questionnaire through the bridge and accepts an answer from the terminal or the runtime, whichever arrives first; the other side then closes. Other extensions' dialogs stay terminal-only.
- **View changes.** The Textual sidebar and dashboard and the Swift notch read the database file directly, read-only, re-reading on change, and send changes (mark seen, preferences, dashboard replies) as single JSON lines over the socket. The tmux plugin keeps its key bindings; its `pane-focus-in` seen hook is removed; the jump binding switches to the runtime's target option.
- **Deleted.** The per-session tmux JSON records and their writer, `agents.py` (`list`, `feed`, `summary`, `next`), the `@pi_seen_at` focus hook, the mailbox JSONL files and their watcher, and `notch.json`. Pi-owned data (session JSONL, settings, auth) and project files (ledger bundles and `history.json`, the wiki, `.pi/LEARNINGS.md`) are not moved; the model indexes or mirrors them.
- **Unchanged.** Views inside a Pi session (the `/work` panel, the input editor) keep reading their own process's state. `pi_exec` workers and forked continuations are not modelled.
- Which components own these modules, and how the existing `tmux-sessions` component is reshaped, are left to ticketing.

### State model

- **tmux topology:** servers keyed by socket path; sessions (`$id`, name), windows (`@id`), and panes (`%id`, tty, current command, current path), all keyed within their server.
- **Session:** by Pi session id; kind root or interactive child; parent session for children.
- **Incarnation:** session id, pid, process start time, generation number, start and end, exit reason; bound to one pane when in tmux.
- **Per-session activity:** process state (starting, alive, alive with bridge lost, exited, lost); run state (idle, thinking, writing a reply, running a tool, compacting); current tool (name, main argument, since); open prompt (kind, title, questionnaire questions); queue (steers, follow-ups, undelivered mail); last error and abort; model, thinking level, context use, cost; configuration.
- **Relations:** supervision (`reportsTo`), parentage, lineage (fork or clone through `parentSession`; resume or switch within a pane), mail edges (from, to, sent, delivered), time-stamped session-to-ledger-task links (current work item = latest link), git context.
- **Attention:** per-session last-seen time; needs you = open prompt, or a new reply since last seen.
- **Conversation:** an index row per completed message and tool call (session, entry id, role, time, tool, size, short preview); full text is read from Pi's session JSONL by entry id through the runtime. No live streaming text.
- **Events:** every lifecycle, turn, completed message, tool start and end, prompt, model, compaction, mail, tmux, and process change, plus command stages and gaps. Streaming text and tool progress only refresh current state.
- **Honesty:** every row carries its source and observation time; commands are kept apart from observations; settled is not done; sent is not delivered.

### Store

- One SQLite file for all apple-pi state, `~/.pi/agent/state/apple-pi.db`, WAL mode: current-state tables plus one append-only event table, mail and its delivery, and UI preferences. Exact tables are designed in the build.
- Keep everything; no retention until measured size or speed shows a problem (2026-10-18: Pi transcripts total 3.2 GB, about 50 MB a day, which the index-and-read-through design avoids duplicating).

### Liveness

- An incarnation is alive while its bridge is connected and heartbeating. When the bridge goes silent, a process check (pid plus start time) decides between "alive, bridge lost" and "exited" or "lost". tmux alone never decides. The heartbeat interval is set and measured during the build.

### Commands

- **Set:** talk (only when idle), steer, follow-up, answer questionnaire, abort; mark seen; send mail; start a session in a tmux window (cwd, name, `reportsTo`, first prompt), reopen by id, close (quit Pi or close its window); rename; change model or thinking level.
- **Receipts:** accepted (stored), delivered (the target incarnation's bridge received it), applied (Pi accepted it), or failed with a reason, each recorded as an event. Never "done".
- **Targeting:** a command bound to one incarnation never reaches a later one. With no live incarnation, everything except mail fails at once with "not running"; mail waits and is delivered when the session next opens.
- **Retries:** each command carries a client-chosen id; a repeat applies once.
- **Authority:** anyone who can open the socket, which is only the operator's user. Confirmations (for example before closing a busy session) belong to each view.

### Preserved behaviour

- Mail delivery keeps today's rules: a steer at the next safe boundary while a run is active, a new turn while idle, and the next turn when mail is waiting at session start; at least once, with the message id identifying a repeat.
- A worker started with `--reports-to` still mails its supervisor when it closes, except on reload.
- `pi-send.mjs` remains the way an outside process sends mail, now as a command to the runtime.
- `/pi-sessions` lists sessions, now from the model.

### Cut-over

- One change moves every producer and consumer; old files and commands are deleted; no compatibility layer. Running sessions pick up the new bridge when they restart.

## Testing Decisions

- Good tests assert observable behaviour at a seam: what a consumer would see in the database, in command receipts, or in tmux. They do not assert internal module structure or event-mapping helpers directly; those are covered through the seams.
- **Seam A (primary), confirmed 2026-10-18:** a real runtime on a temporary state directory and a scratch tmux server (`tmux -L <name> -f /dev/null`), with real bridge extensions inside faux Pi sessions, root and child. Observe only the database (read as a view reads it), command receipts over the socket, and the tmux options the runtime writes. Covers state capture, events, liveness (bridge loss, process exit), reconnect snapshots and gaps, ledger links, every command including questionnaire answering from either side, mail, discovery, and coordinator tools, and the tmux glue (status line, seen from the shown pane, jump target).
- **Seam B, confirmed 2026-10-18:** the Python sidebar and dashboard against a SQLite fixture created by the runtime's own schema migrations, plus the existing fake tmux, so the views' schema cannot drift. The notch keeps its existing checks (Swift type-check and start-up script).
- **Prior art:** `tests/helpers/faux-session.ts` and its use in `components/tasks/tests/mailbox.test.ts` (real extensions in faux sessions); `components/tmux-sessions/tests/tmux-sessions.test.ts` (state redirected to temporary directories through environment variables); `components/tmux-sessions/sidebar/tests/conftest.py` (fake tmux for the Python views); the repository's rule for real tmux tests (a scratch server and a temporary `PI_TMUX_STATE_DIR`, never the operator's server).
- Tests never touch real Pi state, the operator's tmux server, or real session files.

## Out of Scope

- How any consumer presents the state: Agent World's world, themes, and art; the look of the sidebar, dashboard, and notch.
- External systems (Jira, GitHub, Confluence, Slack); they belong to Agent World (`.ledger/202610171741-guildworld/`).
- A separate deterministic orchestrator service; the coordinator session remains the orchestrator.
- `pi_exec` workers and forked continuations as modelled sessions.
- Live streaming text in the model.
- Answering other extensions' select, confirm, and input dialogs from outside the terminal.
- A command-line interface or a query API beyond the socket and the database file.

## Further Notes

- Governing sources: the resolved tickets in [decisions/](decisions/); research in [research/](research/) (Pi extension surface, tmux and process binding, current producers and consumers) and `.ledger/202610171741-guildworld/research/` (apple-pi integration inventory, driving a running Pi session).
- Terms: the "Session state" section of the harness glossary (`.wiki/pages/domain-language.md`): session state model, incarnation, bridge, supervision, lineage, needs you.
- Repository authorities this work must keep: `AGENTS.md` (one package, explicit extension loading in child sessions, append-only request context, no arbitrary caps without evidence), `docs/tmux-sessions.md` and `docs/tasks.md` (to be rewritten with the switch), and `docs/development.md`.
- Agent World's ticket "Shared state model spec lands" (`.ledger/202610171741-guildworld/decisions/18-shared-state-model-spec-lands.md`) resolves when this spec is accepted.
