# Ticket 30: performance measurements

Measured 2026-10-19 on the operator's machine, which was busy: load average 4 to 11 from other lanes, so single
numbers vary by about 10%. The two scratch Vitest files here were copied into `apps/agent-world/tests/` for each run
and deleted afterwards. To run them again, copy one in and set `AW_PERF_LABEL` and `AW_PERF_DORMANT`; results are
written to `/tmp/aw30/`, which must exist.

- `backend-perf.test.ts`: a real session-state runtime, which builds the database with its own migrations. The test
  adds N stopped root sessions to it, each with an ended incarnation, 100 indexed messages, 30 events, and a ledger
  task shared with others (60 `task.md` files). It also adds 5,000 mail commands (1 in 50 still waiting), and an awake
  coordinator with 40 awake workers in one wing, all on fake bridges. It measures:
  - a full snapshot build (`openWorldBackend`'s first poll);
  - the snapshot size;
  - main-thread time while idle, and while one agent's cost changes 10 times a second (event-loop utilisation);
  - publishes per second, and the bytes those publishes would send over IPC.
- `renderer-frames.test.ts`: the built UI in headless Chrome with a fixture backend. 40 workers stand in one wing, with
  N sleepers and 218 mails in the snapshot. It records frame times over 5 s while nothing happens, then while updates
  arrive 5 times a second. Each update is a structured clone, standing in for IPC: either the whole snapshot, or one
  that keeps the inn and mail arrays.

## Backend (main process)

| Sleepers | Code | Full build | Snapshot | Idle | One agent working | Publishes | IPC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3,000 | before | 27 ms | 1.14 MB (dormant 1.06 MB) | 26 ms/s | 123 ms/s | 4.8/s | 5.5 MB/s |
| 3,000 | fix 1 | 22 ms | same | 25 ms/s | 100 ms/s | 4.8/s | same |
| 3,000 | fix 1+2 | 19 ms | same | 14 ms/s | 88 ms/s | 4.8/s | same |
| 3,000 | all fixes | 22 ms | same | 11 ms/s | 30 ms/s | 4.8/s | same |
| 10,000 | before | 85 ms | 3.63 MB | 85 ms/s | 426 ms/s | 4.8/s | 17.5 MB/s |
| 10,000 | all fixes | 64 ms | same | 25 ms/s | 64 ms/s | 4.8/s | same |

Where a 3,000-sleeper read went before (median ms): the `SESSIONS` query 6.3; projection with JSON parsing 3.5; the
inn 8.9, nearly all of it a `stat` of each sleeper's `task.md`; mail 1.8; the publish compare (two `JSON.stringify`
calls) 4.5; `v8.serialize` as IPC 1.1.

- Fix 1: a sleeper's `task.md` is checked only on the 2 s task rereads, and a missing file is cached too. When nothing
  changed, the inn returns the same array.
- Fix 2: `git`, `config`, and `current_task` are each parsed once (`parseShared`). `publish` compares the inn and mail
  by reference, and mail keeps its array while unchanged.
- Fix 3: a reread reads only the rows that newer events name, plus the rows awake at the last read. Every row is still
  read at start, on reconnect, for a new database, and every 30 s. The inn keeps each sleeper made from an unchanged
  row.

## Renderer (headless Chrome, 40 characters in one wing)

| Sleepers | Updates | fps | p95 frame | Frames over 33 ms | Update cost (clone + store) |
| --- | --- | --- | --- | --- | --- |
| 3,000 | none | 59.6 | 16.8 ms | 1 | |
| 3,000 | whole snapshot, 5/s | 60 | 16.8 ms | 0 | 6.5 ms |
| 3,000 | inn and mail kept, 5/s | 59.6 | 16.8 ms | 0 | 4.2 ms |
| 10,000 | none | 59.8 | 16.8 ms | 1 | |
| 10,000 | whole snapshot, 5/s | 58.2 | 16.8 ms | 0 | 13.3 ms |
| 10,000 | inn and mail kept, 5/s | 60 | 16.7 ms | 0 | 4.5 ms |

The results were the same with the Agents tab open, and no long tasks were recorded. The renderer is not slow, so it
was left unchanged. Sending the inn on every update costs about 2 ms per update at 3,000 sleepers and about 9 ms at
10,000 (58 fps). Not sending an unchanged inn would need the main process, the preload, and the renderer's
`world-store.ts` (`web/`) to merge updates, and none of that was built.

Real database on this machine for comparison: 1 root session, 19 child sessions, 28,816 events, 11,523 indexed
messages, about 3,000 events an hour.
