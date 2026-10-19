## symbol:Runtime.takeLock

The single-runtime guarantee is an exclusive SQLite lock held for the runtime's whole life, not a pid file. The pid file only tells tests and people which process to stop.
Why: a pid lock file has a window between create and write that let two runtimes both start; the OS releases an SQLite exclusive lock on any exit, including SIGKILL, so there is no stale lock to reclaim.
Verify: components/session-state/tests/singleton.test.ts

## symbol:Runtime.setRunState

Only the connection of the session's current generation may change its run state; messages from a superseded process are dropped.
Why: an old process that is still connected would otherwise overwrite the new incarnation's activity and stamp its events with the new generation.
Verify: components/session-state/tests/liveness.test.ts

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

A page reads the transcript once and picks its ids in one pass; entries are ordered by the `messages` index (`at`, then `rowid`), not by file position. Byte offsets were deliberately not added: the JSONL is Pi's, and offsets would have to survive appends and rewrites.
Why: `read_entry` reads the whole file per id, so paging through a long transcript one entry at a time scanned it thousands of times.
Verify: components/session-state/tests/history.test.ts
