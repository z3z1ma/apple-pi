# 10: The organization documented

**What to build:** The product contract for people, roles, souls, selves, the org tree, charters, and tools lives in a new `docs/organization.md`; the pages it touches point to it (`docs/session-state.md`, `docs/subagents.md`, `docs/agent-world.md`, `docs/tmux-sessions.md`, `docs/context.md`); the README catalog and setup describe roles and the operator's seat; `AGENTS.md` maps the role catalog and the org to their owners; `docs/boundaries.md` records what was rejected (tree-scoped mail, roles as subagents, role changes, handoff schemas, caps, a second memory store, minds through profiles).

**Blocked by:** 02 The full role catalog; 04 Transfer and retire; 05 A hired person has a soul; 06 Every person keeps a self; 07 The senses only; 08 The terminal shows the org; 09 Agent World shows the org

**Status:** ready-for-agent

- [ ] `docs/organization.md` exists and every tool, flag, and prompt section this task added is described there with its owner.
- [ ] No doc, README, or skill mentions `--coordinator`, the roster file, or the removed subagents as current behaviour.
- [ ] `AGENTS.md` architecture map names the role catalog's directory and the org's owner, and `docs/boundaries.md` lists the rejected ideas.
- [ ] `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run pack:check` pass, with the roles directory in the published files.
