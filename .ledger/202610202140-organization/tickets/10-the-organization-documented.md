# 10: The organization documented

**What to build:** The product contract for people, roles, souls, selves, the org tree, charters, and tools lives in a new `docs/organization.md`; the pages it touches point to it (`docs/session-state.md`, `docs/subagents.md`, `docs/agent-world.md`, `docs/tmux-sessions.md`, `docs/context.md`); the README catalog and setup describe roles and the operator's seat; `AGENTS.md` maps the role catalog and the org to their owners; `docs/boundaries.md` records what was rejected (tree-scoped mail, roles as subagents, role changes, handoff schemas, caps, a second memory store, minds through profiles).

**Blocked by:** 02 The full role catalog; 04 Transfer and retire; 05 A hired person has a soul; 06 Every person keeps a self; 07 The senses only; 08 The terminal shows the org; 09 Agent World shows the org

**Status:** done

- [x] `docs/organization.md` exists and every tool, flag, and prompt section this task added is described there with its owner.
- [x] No doc, README, or skill mentions `--coordinator`, the roster file, or the removed subagents as current behaviour.
- [x] `AGENTS.md` architecture map names the role catalog's directory and the org's owner, and `docs/boundaries.md` lists the rejected ideas.
- [x] `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run pack:check` pass, with the roles directory in the published files.

Deviations: the catalog table in `docs/organization.md` is generated from the role files' front matter (a one-off script, not kept); regenerate it when a role changes. `npm run lint` carries one pre-existing warning in another lane's test file; `apps/agent-world/tests/world-movement.test.ts` has two failures that are red on the base commit too (the hover count and a furniture walk), unrelated to this task.
