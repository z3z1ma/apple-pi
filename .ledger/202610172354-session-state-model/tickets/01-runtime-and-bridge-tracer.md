# 01: Runtime and bridge tracer

**What to build:** A Pi session with the new bridge extension finds no runtime, starts one, and appears in the shared SQLite database with its session, its incarnation (pid, start time, generation), process state, and run state, recorded as current state plus events. The runtime is a single Node daemon per Mac on a Unix socket under the state directory, the only writer to a migrated `node:sqlite` database in WAL mode. Liveness follows the bridge's connection and heartbeats, then a process check. This ticket also builds seam A: a real runtime on a temporary state directory driven by bridges inside faux Pi sessions.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] With no runtime running, starting a faux root Pi session with the bridge starts exactly one runtime; a second session connects to the same runtime instead of starting another.
- [x] The database (opened read-only, as a view would) shows the session by Pi session id with one incarnation carrying pid, process start time, and generation 1, and process state `alive`.
- [x] A prompt that runs a tool and settles moves run state through thinking, writing a reply, running a tool, and idle, and each transition is an event row with source and observation time.
- [x] When the bridge stops heartbeating while its process lives, process state becomes `alive, bridge lost`; when the process is gone, it becomes `exited` (clean shutdown) or `lost` (no shutdown).
- [x] Reopening the same session id creates incarnation generation 2; generation 1 is recorded as ended.
- [x] The database file and socket live under the state directory and follow `PI_CODING_AGENT_DIR`; the schema has a version and is created by a forward migration.
- [x] Tests touch only temporary state directories, never real Pi state.
