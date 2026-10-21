# 01: A session started with a role is that role

**What to build:** A root Pi session started with `--role <name>` becomes that role for life. The role comes from a Markdown catalog with front matter (`title`, `models`, `thinking`, `writes`, `manages`) and a body, discovered from the package's `roles/` directory, then `~/.pi/agent/roles/`, then `<cwd>/.pi/roles/`, later ones overriding by name. At every start the session applies the role's mind (the first listed model the registry knows, at the role's thinking level), its posture (`writes: false` removes the built-in `edit` and `write` tools), and a `<role>` system prompt section with the body. The role is stored on the session's row in the session-state database at first start and re-applied on every later start; a stored role wins over a later flag. `start_peer_session` gains a `role` parameter, and the runtime passes `--role` on start and reopen from what is stored. A role with `manages: true` gets the peer-management tools. `pi --coordinator` goes away: the coordinator is a managing role in the catalog, so `pi --role coordinator` replaces it, with the existing coordinator charter as its body for now. This ticket ships the coordinator and three roles (Staff Engineer Simplicity, Implementation Engineer, Repository Archaeologist); the rest come in 02.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] A session started with `--role staff-engineer-simplicity` runs on the first listed model the registry knows at the role's thinking level, declares no `edit` or `write` tool, and its system prompt contains the role body under `<role>`; a session started with `--role implementation-engineer` keeps `edit` and `write`.
- [x] A role whose listed models are all unknown to the registry starts on the session's default model and warns once.
- [x] After `close_peer_session` and `reopen_peer_session`, the person has the same role, mind, and posture without the flag being passed by the caller; starting the same session id with a different `--role` keeps the stored role.
- [x] A role file in `<cwd>/.pi/roles/` with the same name as a package role replaces it; a file with a missing or malformed front-matter field is reported by name and skipped.
- [x] `start_peer_session` with `role` starts a person that reports to the caller and shows that role; without `role` it starts an unroled person as today.
- [x] `pi --coordinator` is no longer a registered flag; `pi --role coordinator` has the four peer-management tools active and the coordinator charter in its prompt; a non-managing role does not.
- [x] The package-load test, `docs/session-state.md`, and the README no longer mention `--coordinator`.
