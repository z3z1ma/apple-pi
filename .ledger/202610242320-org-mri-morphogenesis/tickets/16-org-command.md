# 16: `/org` for the operator

Part of the approved spec [../spec.md](../spec.md), as redirected by [../direction.md](../direction.md) and the operator's sign-off notes of 2026-10-26.

**What to build:** In a root session, the operator types `/org` for a compact view of the organization from the shared inspection module (open waits grouped by target, ready work without an owner, people holding several tasks, decisions and escalations waiting on people), `/org fitness <since>` for the fitness breakdown, and `/org expertise <area or person>` for who knows what.

This is a read-only operator entrypoint to the existing inspection tools. It reports conditions; it does not assign work or change the organization.

**Blocked by:** 10 (Who talks to whom), 15 (Keep what history needs when temporary peers are discarded).

**Status:** done (committed 7bdb93c9 after scoped review and operator approval; session refresh/live rollout remain separate)

- [x] Through a faux session against a spawned runtime with a known organization, `/org` shows the same counts as `org_waits`, `org_work`, and `org_communication` for the organization, and `/org expertise <area>` the same as `org_expertise`.
- [x] An unknown subcommand explains the choices.
- [x] The package-load smoke test lists the `/org` command.

## Closure evidence

Final Standards/Intent report `t-ea003415` cleared six paths. Independent checks passed 85/85 tests across six relevant suites with `--maxWorkers=2`, Node/web typechecks, loader, Biome on three files, whitespace and context lint on 160 files. Six before/after/final hashes matched; the author's 85-test run and earlier 84-test snapshots remain separately attributed. Actual faux commands against an isolated spawned runtime compare overview counts/references, fresh notices, selected-ID expertise, errors and fitness for a completed $25 task with native results. Separate direct-handler trials verify overview avoids goal reads and colliding area paths remain selectable.

One minor command promise mismatch was repaired: the roster (including the caller) recognized the caller's own name, but the existing native name resolver excluded self. Unique names now normalize to IDs at the common selector; duplicate names, including caller collisions, require IDs. No shared resolver or reader rewrite. The manager's source question, author's faux/native probe and chair's independent handler trial have separate attribution. Contract-positive name controls compare with native selected-ID results rather than inheriting the same failing name input. A separate cold reader was omitted for this small three-form wrapper; independent review covered both axes.

The operator approved 8/8 hunks. All six committed blobs at 7bdb93c9 matched the chair-tested hashes. This ties scoped proof to committed bytes, not an isolated whole-commit or installed-package test. These source-review checks claim no full-suite, native CLI end-to-end, paid-model/new-peer or `pi_exec` composition proof. The later [backend rollout](../rollout.md) is separately recorded; existing sessions still need refreshed package code.
