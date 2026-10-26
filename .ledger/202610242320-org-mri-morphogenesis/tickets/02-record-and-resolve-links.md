# 02: Record and resolve links between work

Part of the approved spec [../spec.md](../spec.md); its Terms table defines obligation, completion, window, horizon, and the other words used here.

**What to build:** Any person can record a link between two existing things (task, person, thread, message, commit, PR, file, check run, organization) with a relation word from one defined list, a reason, optional JSON data, and, when inferred, a confidence; and resolve a link by id, optionally with a resolution word such as `accepted` or `rejected` (one `link` tool: a call without an id records a link, a call with an id resolves that link). The runtime stores links in one new table through a new command, the only writer. A waiting link (`blocks`, `requires_decision`) whose target is a task resolves on its own when that task closes `done`, never on cancellation. The list lives in one package file, each relation with a one-line meaning, starting with `blocks`, `requires_decision`, `produced`, `verifies`, `supersedes`, `predicts`, `fixes`, and `finds`; `link` accepts only listed words, and adding a relation is adding one line to that file, with no other code. The tool's description shows the list with the meanings. The `link` tool is installed for every person (not only managers), the `<org>` section tells every person about it, readers tolerate a database without the table (the runtime is a long-lived daemon), and `docs/session-state.md` describes the table and command.

**Blocked by:** 01 (Record when tasks open and close).

**Status:** ready-for-agent

- [ ] Through a faux session against a spawned runtime, a person without manager tools calls `link` and one row holds both entities, the relation, reason, data, recorder, asserted or inferred, confidence, and creation time; before this ticket the tool does not exist.
- [ ] A link with an unlisted relation word (for example `mentors`) is refused with the list of allowed words; after one line for `mentors` is added to the list file, the same call is stored and returned exactly as given, data included.
- [ ] A `blocks` link and a `requires_decision` link to an ephemeral task, and the same to a ledger task, get a resolution time when that task closes `done`; a ledger task closed `cancelled` leaves them open.
- [ ] A `requires_decision` link to a person stays open after that person posts in a thread with the recorder.
- [ ] Resolving by id with `accepted` stores the resolution time and word once; resolving an unknown id fails with a clear message.
- [ ] The package-load smoke test lists `link`.
