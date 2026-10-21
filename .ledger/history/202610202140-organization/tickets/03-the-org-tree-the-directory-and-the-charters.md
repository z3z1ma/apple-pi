# 03: The org tree, the directory, and the charters

**What to build:** The organization is bound to the root session. A session with no manager is a root; its org is every session whose chain of managers reaches it. A root has the peer-management tools active even without a managing role: it is the operator's seat. `list_peer_sessions` becomes the org directory: every person in the caller's org with id, name, role title, manager, status, directory, current task, and what it has done (its ledger tasks, hire date); sessions in other orgs are not listed. Every root session gets an `<org>` prompt section (who it is, its manager and root, mail and directory, the tree norms: take work from and report to your manager, escalate up, copy managers on cross-team exchanges that change a decision or a load, say what you verified and what you believe). Managers and roots get the `<manager>` charter: the coordinator charter reworked with the roster file removed, "your principal" in place of "the operator", and the new rules: hire from the catalog for colliding perspectives, give independent thinkers the problem before the preferred answer, name disagreements rather than average them, escalate by uncertainty times consequence, hire a manager under you when your fan-in would make you the bottleneck.

**Blocked by:** 01 A session started with a role is that role

**Status:** done

- [x] With two roots X and Y on one runtime, each with hires at two depths, `list_peer_sessions` from a leaf under X lists exactly X's org, including X, and none of Y's; mail by id from X's leaf to Y's leaf still arrives.
- [x] A plain root session (no role) has the peer-management tools active; a hired non-managing person does not; a hired Director of Engineering does.
- [x] The directory entry of a person shows its role title, manager id, hire date, and the ledger tasks it has owned.
- [x] Every root session's prompt has an `<org>` section with its own id, manager, and root; a hired manager's `<manager>` section names its manager as its principal, and a root's names the operator.
- [x] The coordinator charter no longer asks for a roster file, and `docs/session-state.md` describes the org, the directory, and the charters.

Deviations: the `<manager>` charter goes to managing roles only; a root without one holds the tools and is told so in `<org>` (the full charter would tell every plain operator session to schedule sweeps). The directory shows the role's catalog name, which is what `start_peer_session` takes, not its title. Resolved in test by one runtime with the caller as root, a hire, a sleeping hire under it, a stranger, and a subagent.
