# 10: Recruiting agents

**What to build:** The operator creates agents from inside the world, in the theme's words (the guild recruits, the office hires, the club invites a new member). In the headquarters, the coordinator's desk offers to recruit a worker, who reports to that coordinator; in the square, a recruiter NPC at a booth recruits an independent agent. A themed form asks for a name, a repository (picked from known repositories or a path), and an opening brief; it sends `start` with `reportsTo` for workers and none for independents; the new character walks in.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Recruiting at the coordinator's desk sends `start` with `reportsTo` the coordinator, a new window opens after the coordinator's pane, and the new worker walks into its wing (a scratch tmux server and fake `pi` in the backend test).
- [ ] Recruiting at the square's recruiter sends `start` without `reportsTo`, and the new independent agent appears in the square.
- [ ] Each pack names the action and the recruiter in its own words (`theme.json`), validated by the pack check.
- [ ] Judged on screenshots in all three themes against `apps/agent-world/art/STYLE.md` and the polish bar in `.ledger/history/202610171741-guildworld/spec.md` (Further Notes).
