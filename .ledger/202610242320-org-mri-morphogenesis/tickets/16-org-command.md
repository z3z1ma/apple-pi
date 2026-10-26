# 16: `/org` for the operator

Part of the approved spec [../spec.md](../spec.md), as redirected by [../direction.md](../direction.md) and the operator's sign-off notes of 2026-10-26.

**What to build:** In a root session, the operator types `/org` for a compact view of the organization from the shared inspection module (open waits grouped by target, ready work without an owner, people holding several tasks, decisions and escalations waiting on people), `/org fitness <since>` for the fitness breakdown, and `/org expertise <area or person>` for who knows what.

**Blocked by:** 10 (Who talks to whom), 15 (Keep what history needs when temporary peers are discarded).

**Status:** ready-for-agent

- [ ] Through a faux session against a spawned runtime with a known organization, `/org` shows the same counts as `org_waits`, `org_work`, and `org_communication` for the organization, and `/org expertise <area>` the same as `org_expertise`.
- [ ] An unknown subcommand explains the choices.
- [ ] The package-load smoke test lists the `/org` command.
