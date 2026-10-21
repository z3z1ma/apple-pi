# 08: The terminal shows the org

**What to build:** The tmux sidebar and dashboard draw the org as a tree: each root, then its people indented under their managers, with the role title beside the name, and former members folded at the end. A plain `pi` session with no hires is a root of one, shown as today.

**Blocked by:** 03 The org tree, the directory, and the charters

**Status:** ready-for-agent

- [ ] In the sidebar test with a root, a manager under it, and two people under the manager, the rows are indented by depth and show role titles.
- [ ] A retired person is folded under a former-members row that opens on demand.
- [ ] A database without the new columns (an old runtime) renders as before, with no role or tree.
