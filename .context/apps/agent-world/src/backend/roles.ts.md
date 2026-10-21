## symbol:loadRoleChoices

Reads only the front matter of each role file, as scalar `key: value` lines, from the package's `roles/` directory and then `~/.pi/agent/roles/` (a later file replaces an earlier one of the same name), without `components/organization/src/roles.ts`; a file with no `title` or `mandate` is skipped silently. The project-local `<cwd>/.pi/roles/` layer is not read.
Why: the backend may import nothing from `components/` (see `world-backend.ts`), so the catalog the hire form offers is a second, narrower reader of the same files, and it must keep the same directories and precedence or the form would offer a role the hired session's own loader resolves differently. The project layer needs the hired session's working directory, which the form chooses only after the role; the runtime rejects a role the full loader lacks.
Coupled: components/organization/src/roles.ts, apps/agent-world/src/backend/lifecycle.ts
Verify: apps/agent-world/tests/world-recruit.test.ts
