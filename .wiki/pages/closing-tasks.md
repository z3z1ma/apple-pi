# Closing tasks

How to close runtime tasks and ledger tasks in bulk without leaving rows open. `docs/ledger.md` and `docs/organization.md` own the contracts; this page records the mechanics found during a cleanup of stale tasks.

## Which tool closes what

- `progress` lists runtime tasks, including ledger tasks promoted from ephemeral ones.
- `ledger_status done` or `cancelled` archives a ledger bundle; for a promoted task it also closes the runtime row when nobody holds it.
- A task you hold: `focus` it, then `finish_task`.
- An unheld ephemeral task: `take_task`, then `finish_task`.
- A task a departed or exited colleague holds: `unassign` them first, then close it as above.

## Pitfalls

- `focus` fails on a work UUID retyped from memory. `focus` with `.ledger/<dir>` resolves a promoted task reliably; copy ephemeral ids from `progress` output.
- Archiving moves a bundle under `.ledger/history/`. Fix what pointed at the old path: `.context/.ledger/...` files, relative imports, links and learnings.
- `ledger_status done` leaves the bundle's context files at `.context/.ledger/<id>/`, and `context_lint` then reports orphans and broken `Coupled:`/`Verify:` paths. Move them to `.context/.ledger/history/<id>/`, rewrite `.ledger/<id>/` to `.ledger/history/<id>/` inside them, run `context_lint` in a later call, and commit both trees with `git add -A -- <old> <new>`.
- Before writing a closing outcome, check its claims against current facts (git, directory, configuration); a task's last recorded state is often stale.
