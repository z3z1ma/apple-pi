# Ticket 14 implementation

Three parallel lanes rewrote the docs to describe the current code. Lane A owned organization, session-state, Agent World, exec, pair, interns, scheduling, and model profiles. Lane B owned the other docs and the wiki. Lane C owned `AGENTS.md`, `README.md`, and `docs/boundaries.md`. The lead fixed the remaining unowned docs (`mcp`, `home-search-guard`, `setup`, `code-review`, `ledger`) and stale code comments.

- `docs/subagents.md` is deleted. Its still-true work panel section is `docs/tasks.md#work-panel` (Tasks and Pi Exec tabs).
- `docs/organization.md` has a workplace-tools table and a manager-tools table. Threads, assignments, ephemeral tasks, the operator as a person, and program peers are in their owning docs.
- `docs/boundaries.md` lists the rejected ideas with reasons: custom agents, background subagents, pushed channels, assignment tickets beyond tasks, and calendars.
- `AGENTS.md` names four execution contexts: root sessions (every person, including program peers), intern processes, `pi_exec` guests, and internal sessions (`/btw`, the pair sidecar, forked continuations).
- The unused `SESSION_STATE_EXTENSION_PATH` export is removed. Comments that described subagents or `clarify` now describe current behaviour.
- A former member at the inn no longer offers the give action; the runtime would refuse it anyway.

The lanes found these places where code and spec differ. The docs follow the code: `remind_me` takes `delay_seconds` with `text` or `command`; the bridge protocol still accepts the old `child` hello; a wing banner opens the headquarters' team channel, not a nested manager's; five unused profile names are still accepted; the `<manager>` charter says "standup"; old transcripts keep a `consultant` note source.

## Verification

The search for removed names in docs, `AGENTS.md`, `README.md`, and the wiki finds only the rejected-ideas entries in `boundaries.md`, the `pi-subagents` provenance row, and the browser page's "clarify this" label. `wiki_lint` (11 pages, 41 links), `context_lint` (134 files), `format:check`, `lint`, `typecheck`, both builds, and `pack:check` passed.

The full suite ran as its six steps (`/tmp/apc14-full.log`). Art, sidebar, pair, and loader passed. Unit failed one test (1393 passed) and World failed one test (771 passed), both timeouts while the load average was near 19. Each file passed when rerun alone: `tests/pi-exec-work-panel.test.ts` (32 tests) and `world-forge.test.ts` (11 tests); logs are `/tmp/apc14-rerun-{exec,forge}.log`.
