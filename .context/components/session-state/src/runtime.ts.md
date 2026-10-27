## symbol:Runtime.checkFriction

Startup and the existing liveness timer observe committed structural changes. Connection closure still checks process liveness but does not replay coordination history for every command socket. Its journal watermark is only a cheap trigger filter; the planner and durable raised/cleared entries remain authoritative. Include delivered/failed work because assignment persistence can precede a failed wake. Tool/cost/run-state chatter and alert mail receipts do not trigger graph replay. No extra polling timer, age threshold or process-local notification authority is introduced.
Why: replaying global history on every heartbeat was measurably expensive; the complete publication helper still costs hundreds of milliseconds on a representative copy, so command-socket closures must not turn a burst into one replay per command. Watching only successful work would miss a saved assignment whose recipient could not wake.

Shared notice, complete outgoing mail and raised marker commit together, followed by dispatch. A failed publication rolls back only that observation, preserves the producing work and leaves the watermark retryable. Startup recomputes against the durable journal; silent clears rearm recurrence, and recipient changes raise a new scoped condition. The harness posts factual evidence, not a management decision or proof of reading.
Coupled: components/session-state/src/friction.ts, components/session-state/src/threads.ts
Verify: components/session-state/tests/friction-delivery.test.ts

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

Durable temporary identity participates in hello admission even when the incoming bridge has no program flags. A retained transcript preserves UUID while ordinary resume can lose its program environment; only valid live scope/owner/parent matching permits a temporary hello. Rejection sends close before incarnation/person/facts writes. Valid first program hello and same-process reconnect retain their existing behavior, as do ordinary new IDs. This is the same lifetime no-reopen boundary as startSession, not a new ACL or hostile-socket policy.
Verify: components/session-state/tests/peer-history.test.ts

The hello's `reportsTo` is applied only while the record's `reports_to` is null; afterwards the record wins, and a bridge whose flag disagrees is sent a `transfer` command with its recorded manager.
Why: the flag is what the session was started with, and `move` changes the manager after that; a reconnect or hand restart carrying the old flag would otherwise undo the move, and the bridge addresses its close notice from its own copy of the manager.
A same-process reconnect keeps its incarnation's original tmux binding. A test that adds a pane needs a new incarnation, rather than a second hello from the same PID and start time.
Ordinary close receipts remain incarnation-bound: a later ordinary call_in can receive queued mail without replaying an old incarnation's close. Permanent/legacy former admission guards run before normal incarnation creation or mail replay; those identities do not use an ordinary reopen path.
Coupled: components/session-state/src/bridge.ts, components/session-state/src/coordinator.ts
Verify: components/session-state/tests/organization.test.ts, components/session-state/tests/program-peers.test.ts

## symbol:Runtime.commandProgress

A `run_turn` result travels only to its waiting command connection; Pi's transcript remains the durable reply owner. Progress snapshots are coalesced for a slow reader, and a terminal receipt drops any held snapshot. Losing the caller cancels that request, not unrelated work in the recipient. Startup fails unfinished turn commands because their waiting connections and transient results cannot be recovered.
Coupled: components/session-state/src/bridge.ts, components/session-state/src/peer-turns.ts
Verify: components/session-state/tests/peer-turns.test.ts, components/session-state/tests/streaming.test.ts

## symbol:Runtime.threadPost

The message, any meeting closure, and every outgoing delivery commit in one transaction before a bridge receives the mail. Startup completes accepted `thread_post` commands: a stored message means its outbox committed; an absent message means the post still needs applying.
Why: acknowledging or delivering between these writes can leave a closed meeting without its summary at one participant, or a durable message without all recipients after a crash. Delivery remains idempotent through the existing command ids and transcript receipts.
Envelope fromName is supplied only when it adds a human label beyond the raw address; operator/raw-ID headers keep their existing rendering, while named departed authors use retained attribution. A generic display-name fallback is not itself an envelope-label contract.
Coupled: components/session-state/src/threads.ts
Verify: components/session-state/tests/thread-recovery.test.ts

## symbol:Runtime.applyWork

Assignment state, the task thread post, and its outbox commit together. A caught error restores file changes too. `delivered` is recorded before any task-file mutation: startup can replay an untouched `accepted` command, finish a committed change, or report an interrupted uncommitted file operation for inspection. It never blindly republishes a ledger bundle after a mid-file-change crash.
Why: SQLite and the filesystem have no shared atomic commit, so claiming success or replaying a partly published ledger index would hide a real failure.
Coupled: components/session-state/src/work.ts, components/shared/src/ledger-files.ts
Verify: components/session-state/tests/work-recovery.test.ts

## symbol:Runtime.workRecord

A task's open or close, and a link's record or resolution, commit in one transaction with their effects, and the command turns `applied` only after the commit. Startup replays every such command still `accepted` at its accepted time; each is idempotent (a known task is returned, a close is recorded once, a link id is the command id, and a replayed resolution with the same word is accepted).
Why: the ledger files are already archived when `task_moved` arrives, so a lost close cannot be retried from the old live path, and fitness history would keep an obligation open forever. A review reproduced a seeded accepted `task_opened` staying accepted with no record after restart.
Coupled: components/session-state/src/work.ts, components/session-state/src/links.ts, extensions/ledger.ts
Verify: components/session-state/tests/work-recovery.test.ts, components/session-state/tests/links.test.ts

## symbol:Runtime.applyFacts

A session snapshot change and its `<column>_changed` event commit in one transaction, and a move's snapshot, `manager_changes` row, and `transferred` event likewise. A hello's cost is marked `hello: true` when no `cost_changed` was ever recorded for the session, checked inside that same transaction.
Why: fitness replays these events as history. A crash between snapshot and event lost the event for good, because the next report finds the snapshot already equal; review reproduced an independent session's $4 entering an organization that way. Row existence was not a durable first-sight marker: hello writes the row before its facts, and a hire creates it before any hello.
Coupled: components/session-state/src/fitness.ts
Verify: components/session-state/tests/cost-history.test.ts

## symbol:Runtime.finishWorkCommand

An awake assignee needs no launch. A sleeping assignee wakes beside the assigning session's pane; an operator assignment instead uses the terminal supplied by the UI, because `operator` has no session row or incarnation. The wake target stays in the persisted command for recovery. A wake failure reports that the assignment was already saved rather than claiming it rolled back.
Coupled: components/session-state/src/work.ts, apps/agent-world/src/backend/workplace.ts, apps/agent-world/src/backend/inn.ts
Verify: apps/agent-world/tests/inn.test.ts, components/session-state/tests/work.test.ts

## symbol:Runtime.startSession

A temporary launch ownership row, immutable `program_peer_created` caller fact and new-identity zero `cost_changed` baseline commit atomically before provisional work/person/process creation. Existing or legacy identities never get invented zero baselines. The shared cannot-reopen guard uses durable temporary identity, not only live ownership rows; otherwise explicit session-id reuse after disposal would turn a lifetime temporary ID into an incorrectly attributed lasting hire or another caller's peer.
Why: first positive hello otherwise treats a brand-new peer's real spend as old transcript cost; a failed identity/baseline write must not leave partial launch ownership. Lasting identity and caller cannot be overwritten by reusing a discarded ID.
Verify: components/session-state/tests/peer-history.test.ts

A new hire's provisional person, goal bundle, assignment, task thread, team-history snapshot, and outbox commit before opening its process. The history uses the existing channel reader, with no separate summary or invented message-count cap. Pi starts with a pointer to its focused task; startup mail carries the file itself. Reopening keeps the stored role and work, while a supplied new goal adds an assignment.
Why: passing only a prompt leaves the first turn without an explicit job; an ordinary wake preserves the existing person's role and work.
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

Acceptance starts a runtime-owned departure job; caller disconnection does not cancel it. It waits for ordinary work to finish, wakes a dormant person under its stored identity and requests a correlated final turn in that person's retained session. Successful final prose is saved verbatim as private durable Markdown, not posted as shared mail. Empty/failed handoffs and newly arrived responsibilities refuse the irreversible commit while preserving the live person/transcript.

The durable handoff precedes the atomic person_departed marker, retired snapshot, notices and incarnation-bound close. From that commit the identity cannot return. File/private-record removal is a separate retryable phase gated by observed writer/process/pane proof; applied means cleanup completed, not merely that the model replied. Startup resumes committed cleanup without another paid turn, while an interrupted precommit job fails for inspection. Final-turn cost arrives through the existing bridge observation convention before departure rather than being synthesized from reply.usage.

Internal turn commands use this runtime's explicit socket, so isolated tests cannot contact the operator's daemon. A failed handoff can leave a newly awakened person available for inspection. Shared receipts/outcomes/history and retained name/accounting seeds survive private cleanup.
Coupled: components/session-state/src/departures.ts, components/session-state/src/client.ts, components/session-state/src/peer-turns.ts, apps/agent-world/src/backend/lifecycle.ts
Verify: components/session-state/tests/departure-lifecycle.test.ts, components/session-state/tests/departures.test.ts, components/session-state/tests/workplace.test.ts, components/session-state/tests/workplace-wake.test.ts, components/session-state/tests/workplace-recovery.test.ts

## symbol:Runtime.rejectDepartureHello

Permanent departed UUIDs are refused before incarnation/person/facts writes. Their narrow writer observations preserve PID/start and exact reported files without admitting a person; late attempts reopen only cleanup work. A different UUID refused solely because its manager departed acquires no cleanup ownership. Stored legacy former rows also reject before writes but gain no permanent marker, writer journal or purge job; active legacy retired-to-rehired rows with null retired_at still admit.
Why: a close request does not prove an SDK host stopped writing, and a manager's departure is not authority to delete a different person's files.
Verify: components/session-state/tests/departure-lifecycle.test.ts

## symbol:Runtime.stopDepartureWriters

Shutdown/ended incarnation is not OS death. PID/start and newer session bindings govern which writers can be stopped; a proven newer binding to another identity remains untouched. Revalidate the writer/incarnation watermark after awaits and before unlink/cleanup. Known live unacknowledged closes remain pending rather than acquiring an invented timeout. Exact session-header identity gates transcript unlink; mismatches preserve files for retry, and tmux removal requires the expected dead PID in the server-side condition.
Why: rejected resumes, same-PID SDK switches and pane respawns cross asynchronous cleanup boundaries. These are cooperative harness ownership proofs, not hostile-socket or arbitrary orphan-process guarantees.
Coupled: components/session-state/src/departures.ts, components/session-state/src/tmux.ts
Verify: components/session-state/tests/departure-lifecycle.test.ts, components/session-state/tests/tmux.test.ts

## symbol:Runtime.transfer

A move is refused when the new manager is the person, is under the person, or is in another organization (a different root), so the tree stays one tree; the person's own reports keep reporting to it and move with it.
Why: the directory and the charters assume one root per organization and no cycles; a cycle would make `rootOf` stop at an arbitrary member.
Verify: components/session-state/tests/organization.test.ts
