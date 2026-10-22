## symbol:Runtime.takeLock

The single-runtime guarantee is an exclusive SQLite lock held for the runtime's whole life, not a pid file. The pid file only tells tests and people which process to stop.
Why: a pid lock file has a window between create and write that let two runtimes both start; the OS releases an SQLite exclusive lock on any exit, including SIGKILL, so there is no stale lock to reclaim.
Verify: components/session-state/tests/singleton.test.ts

## symbol:Runtime.setRunState

Only the connection of the session's current generation may change its run state; messages from a superseded process are dropped.
Why: an old process that is still connected would otherwise overwrite the new incarnation's activity and stamp its events with the new generation.
A temporary program peer's settled reply is consumed by its program, so settling records the time without creating operator attention. Open questionnaires keep their normal attention path.
Verify: components/session-state/tests/liveness.test.ts, components/session-state/tests/program-peers.test.ts

## symbol:Runtime.pollTmux

Each server is read on its own with a deadline of one poll interval; a server whose read fails or times out keeps its rows (one `tmux_server_read_failed` event and one log line until a read succeeds), and only tmux's own "no server" answer removes them.
Why: reading all servers with one `Promise.all` let a single hung server freeze the topology of every server, and treating any failure as absence deleted live servers' rows and wrote false removal events.
Coupled: components/session-state/src/tmux.ts
Verify: components/session-state/tests/tmux.test.ts

## symbol:Runtime.stop

`stop` aborts in-flight tmux reads and clears `this.db` before closing it; async work checks `this.db` after every await.
Why: a poll that resumed after shutdown otherwise wrote to a closed database.

## symbol:Runtime.checkLiveness

Liveness covers every incarnation whose process state is still alive or alive with the bridge lost, including ended (superseded) ones, and only a proven-gone process ends as `lost`; a failed check stays `alive_bridge_lost`.
Why: filtering on `ended_at` left superseded incarnations reading as alive forever after their process died, and treating a failed `ps` as death permanently ended live sessions.
Verify: components/session-state/tests/liveness.test.ts

## symbol:Runtime.relay

Reply streams are never awaited on a subscriber: a client whose socket needs draining is written nothing more until its `drain`, and meanwhile holds per session only the newest stream's text (one coalesced delta) and the last end. Even a client that reads promptly can be held during a burst, so an end keeps its own stream's held text; only a newer stream drops an older one's text.
Why: writing every delta to a stalled client queued an entire reply per client in the runtime's memory; dropping held text at the end truncated replies for clients that were merely behind a burst (seen as `seq` 367 of 400).
Coupled: components/session-state/src/bridge.ts, docs/session-state.md
Verify: components/session-state/tests/streaming.test.ts

## symbol:Runtime.readEntries

A page reads the transcript once and picks its ids in one pass; entries are ordered by the `messages` index (`at`, then `rowid`), not by file position. Byte offsets were deliberately not added: the JSONL is Pi's, and offsets would have to survive appends and rewrites. Both `read_entry` and `read_entries` stream the file line by line (`scanTranscript`) and parse only lines whose first id is wanted; the scan reads to the end, which keeps one open per page.
Why: `read_entry` reads the whole file per id, so paging through a long transcript one entry at a time scanned it thousands of times; reading the file as one string failed with "Invalid string length" on a 390 MB session, which now pages in about 0.8 s.
Verify: components/session-state/tests/history.test.ts

## symbol:Runtime.hello

The hello's `reportsTo` is applied only while the record's `reports_to` is null; afterwards the record wins, and a bridge whose flag disagrees is sent a `transfer` command with its recorded manager.
Why: the flag is what the session was started with, and `move` changes the manager after that; a reconnect or hand restart carrying the old flag would otherwise undo the move, and the bridge addresses its close notice from its own copy of the manager.
A same-process reconnect keeps its incarnation's original tmux binding. A test that adds a pane needs a new incarnation, rather than a second hello from the same PID and start time.
A committed retirement's pending close takes precedence over mail replay and stays bound to the retired incarnation. Old mail waits for a later reopening; replaying it before closing could start new work in a person who has already left.
Coupled: components/session-state/src/bridge.ts, components/session-state/src/coordinator.ts
Verify: components/session-state/tests/organization.test.ts, components/session-state/tests/program-peers.test.ts

## symbol:Runtime.commandProgress

A `run_turn` result travels only to its waiting command connection; Pi's transcript remains the durable reply owner. Progress snapshots are coalesced for a slow reader, and a terminal receipt drops any held snapshot. Losing the caller cancels that request, not unrelated work in the recipient. Startup fails unfinished turn commands because their waiting connections and transient results cannot be recovered.
Coupled: components/session-state/src/bridge.ts, components/session-state/src/peer-turns.ts
Verify: components/session-state/tests/peer-turns.test.ts, components/session-state/tests/streaming.test.ts

## symbol:Runtime.threadPost

The message, any meeting closure, and every outgoing delivery commit in one transaction before a bridge receives the mail. Startup completes accepted `thread_post` commands: a stored message means its outbox committed; an absent message means the post still needs applying.
Why: acknowledging or delivering between these writes can leave a closed meeting without its summary at one participant, or a durable message without all recipients after a crash. Delivery remains idempotent through the existing command ids and transcript receipts.
Coupled: components/session-state/src/threads.ts
Verify: components/session-state/tests/thread-recovery.test.ts

## symbol:Runtime.applyWork

Assignment state, the task thread post, and its outbox commit together. A caught error restores file changes too. `delivered` is recorded before any task-file mutation: startup can replay an untouched `accepted` command, finish a committed change, or report an interrupted uncommitted file operation for inspection. It never blindly republishes a ledger bundle after a mid-file-change crash.
Why: SQLite and the filesystem have no shared atomic commit, so claiming success or replaying a partly published ledger index would hide a real failure.
Coupled: components/session-state/src/work.ts, components/shared/src/ledger-files.ts
Verify: components/session-state/tests/work-recovery.test.ts

## symbol:Runtime.finishWorkCommand

An awake assignee needs no launch. A sleeping assignee wakes beside the assigning session's pane; an operator assignment instead uses the terminal supplied by the UI, because `operator` has no session row or incarnation. The wake target stays in the persisted command for recovery. A wake failure reports that the assignment was already saved rather than claiming it rolled back.
Coupled: components/session-state/src/work.ts, apps/agent-world/src/backend/workplace.ts, apps/agent-world/src/backend/inn.ts
Verify: apps/agent-world/tests/inn.test.ts, components/session-state/tests/work.test.ts

## symbol:Runtime.startSession

A new hire's provisional person, goal bundle, assignment, task thread, team-history snapshot, and outbox commit before opening its process. The history uses the existing channel reader, with no separate summary or invented message-count cap. Pi starts with a pointer to its focused task; startup mail carries the file itself. Reopening keeps the stored role and work, while a supplied new goal adds an assignment.
Why: passing only a prompt leaves the first turn without an explicit job; failing to preserve the role changes the person's mind on rehire.
Coupled: components/session-state/src/work.ts, components/session-state/src/bridge.ts
Verify: components/session-state/tests/coordinator.test.ts, components/session-state/tests/workplace.test.ts, apps/agent-world/tests/recruit.test.ts

## symbol:Runtime.closeProgram

A program scope stays until its temporary people, nested scopes, and requested turns have ended. The scope tree follows the temporary caller's ownership, while person cleanup follows immutable creation ancestry. Both survive reporting transfers. Startup closes abandoned scopes; their records let a disconnected caller confirm cleanup rather than treating a closed socket as proof.
Coupled: components/session-state/src/program-client.ts, components/session-state/src/program-peers.ts, components/session-state/src/schema.ts
Verify: components/session-state/tests/program-peers.test.ts

## symbol:Runtime.stopProgramPeer

Prove OS process death before discarding ownership, including ended or superseded incarnations. A bridge shutdown can precede process exit. SIGTERM lets native Pi clean its detached tool processes; PID/start-time checks protect reused PIDs.

Before the first hello, recovery may have only a launch record. The tmux initial command identifies a window even if its name changed before the returned pane id was recorded. A renamed-window crash test caught disposal falsely succeeding while the process still ran when recovery used only the name.
Coupled: components/session-state/src/tmux.ts, components/session-state/src/program-peers.ts
Verify: components/session-state/tests/program-peers.test.ts

## symbol:Runtime.launchSession

Both tmux and headless launches receive startup work through a bridge steer after hello and mail replay. A positional CLI prompt can start before onboarding context arrives, and RPC mode ignores it anyway. A program peer or a person woken for handover starts with an empty startup prompt: replayed mail rides its next turn, and only the correlated request starts that turn. Passing a second startup goal would produce unobserved, duplicate work.
Coupled: components/session-state/src/bridge.ts, components/session-state/src/mail.ts, components/session-state/src/peer-turns.ts
Verify: components/session-state/tests/program-peers.test.ts, components/session-state/tests/coordinator.test.ts

## symbol:Runtime.retireSession

Retirement asks for a correlated turn in the person's own session, waits for idle, and wakes a sleeper with its stored identity. The model is told that its final prose becomes its handover post; the runtime publishes that reply verbatim rather than inventing a summary or requiring another handoff artifact. Ordinary work already in progress is left alone.

The handover, retirement, membership change, and incarnation-bound close outbox commit together. Startup recognizes the committed post and completes the receipt; an interrupted uncommitted request fails for inspection instead of rerunning paid model work. A reconnect replays the close only to that incarnation, preserving later rehire.

Caller disconnection cancels only the owned handover. Failure leaves the person unretired; a sleeper woken for a failed handover stays available for inspection. Internal commands use this runtime's explicit socket, so a scratch runtime cannot accidentally reach or start the operator's default daemon.
Coupled: components/session-state/src/client.ts, components/session-state/src/peer-turns.ts, apps/agent-world/src/backend/lifecycle.ts
Verify: components/session-state/tests/workplace.test.ts, components/session-state/tests/workplace-wake.test.ts, components/session-state/tests/workplace-recovery.test.ts

## symbol:Runtime.transfer

A move is refused when the new manager is the person, is under the person, or is in another organization (a different root), so the tree stays one tree; the person's own reports keep reporting to it and move with it.
Why: the directory and the charters assume one root per organization and no cycles; a cycle would make `rootOf` stop at an arbitrary member.
Verify: components/session-state/tests/organization.test.ts
