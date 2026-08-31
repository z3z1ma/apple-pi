# Session backlog


> **Optional extension.** The default harness does not load the session backlog, its tools, manager, widget status, or prompts. Activate `optional-extensions/backlog/index.ts` explicitly; see [optional extensions](optional-extensions.md).

The session backlog is a lightweight parking place for concrete work discovered while something else is active. It prevents worthwhile adjacent work from derailing the current task or being prematurely turned into a durable ledger commitment.

## Model tools

`backlog_add` parks one item with:

- a one-line title of at most 160 characters;
- an optional description of at most 2,000 characters.

The model should use it only for concrete, worthwhile work outside the active scope. Adding an item does not start the work or promote it to ledger.

`backlog_list` reads the current ordered backlog and exposes each item's stable numeric ID.

`backlog_take` removes one item by ID when the model begins handling it in the active work, or after the human and model agree to promote it and it has been successfully recorded as a ledger task. Taking an item only clears the parked entry; it does not complete the work or create the ledger task. Editing, arbitrary deletion, and ordering remain human-owned through `/backlog`.

## Human manager

Run `/backlog` in the TUI to open the backlog manager. The selected item shows its full title and description.

- `c` creates an item by prompting for its title and optional description.
- Up/Down selects an item.
- Shift+Up/Shift+Down changes its persistent manual rank.
- `e` edits its title and description.
- `d` asks for confirmation and deletes it.
- Escape or Ctrl+C closes the manager.

The model may choose to begin active work on a listed item. For Backlog → to-do, it first creates the to-do and calls `backlog_take` only after that succeeds. For Backlog → ledger, promotion remains an explicit human/model decision: call `ledger_add` first, then `backlog_take` only after success. Neither transition requires a separate trip through the manager once it has actually happened.

## Persistence and branching

Backlog state is stored as custom entries in Pi's session JSONL. It is not written into the repository and does not enter model context automatically.

State follows the active session branch. Reloading or resuming reconstructs the backlog from that branch; navigating or forking sees the backlog as it existed at the selected point. Changes on one branch do not rewrite another branch's backlog.

When the branch contains parked items, the TUI input card's bottom information strip shows `backlog N`. The indicator disappears when the backlog is empty.
