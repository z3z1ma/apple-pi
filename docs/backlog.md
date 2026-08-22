# Session backlog

The session backlog is a lightweight parking place for concrete work discovered while something else is active. It prevents worthwhile adjacent work from derailing the current task or being prematurely turned into a durable Ledger commitment.

The intended distinction is:

- active execution steps belong in [to-dos](todos.md);
- backlog items are intentionally parked for later consideration;
- [Ledger](ledger.md) tasks are durable commitments with an explicit lifecycle and acceptance criteria.

## Model tools

`backlog_add` parks one item with:

- a one-line title of at most 160 characters;
- an optional description of at most 2,000 characters.

The model should use it only for concrete, worthwhile work outside the active scope. Adding an item does not start the work or promote it to Ledger.

`backlog_list` reads the current ordered backlog and exposes each item's stable numeric ID.

`backlog_take` removes one item by ID when the model begins handling it in the active work, or after the human and model agree to promote it and it has been successfully recorded as a Ledger task. Taking an item only clears the parked entry; it does not complete the work or create the Ledger task. Editing, arbitrary deletion, and ordering remain human-owned through `/backlog`.

## Human manager

Run `/backlog` in the TUI to open the backlog manager. The selected item shows its full title and description.

- Up/Down selects an item.
- Shift+Up/Shift+Down changes its persistent manual rank.
- `e` edits its title and description.
- `d` asks for confirmation and deletes it.
- Escape or Ctrl+C closes the manager.

The model may choose to begin active work on a listed item. For Backlog → to-do, it first creates the to-do and calls `backlog_take` only after that succeeds. For Backlog → Ledger, promotion remains an explicit human/model decision: call `ledger_add` first, then `backlog_take` only after success. Neither transition requires a separate trip through the manager once it has actually happened.

## Persistence and branching

Backlog state is stored as custom entries in Pi's session JSONL. It is not written into the repository and does not enter model context automatically.

State follows the active session branch. Reloading or resuming reconstructs the backlog from that branch; navigating or forking sees the backlog as it existed at the selected point. Changes on one branch do not rewrite another branch's backlog.

When the branch contains parked items, the TUI input card's bottom information strip shows `backlog N`. The indicator disappears when the backlog is empty.
