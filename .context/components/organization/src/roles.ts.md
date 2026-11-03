## file

A role is one Markdown file: front matter for title, mind, posture, and whether it manages, and a body that is the obligation. Catalog directories override in order: the package `roles/`, then `~/.pi/agent/roles/`, then `<cwd>/.pi/roles/`. A later file of the same name replaces an earlier one. `dispatches` means the person only routes work: no shell, file-writing, or program tools.
Why: a project role must be able to replace the package role without a second catalog, and a dispatcher must not gain the tools it exists to avoid.

After changing role frontmatter and its parser together in a live checkout, reload the calling Pi session before hiring against the updated format. Preserve available colleagues until the reload is authorized. The role parser belongs to the Pi session; this boundary needs a session reload rather than a runtime-daemon restart.
Why: a running session can apply its old parser to new role files and report an empty catalog or an unknown role even though the files remain present.
Coupled: components/organization/src/session-role.ts
Verify: components/organization/tests/roles.test.ts

## symbol:parseRoleModel

The effort suffix belongs to role-frontmatter recommendations only. Global profile entries and retained `organization-role` minds still pair an exact provider/model identity with a separate thinking level. Startup must strip the suffix before registry lookup and retain the actual model identity plus effective effort, not the encoded recommendation.
Why: saved minds bypass role/profile selection on resume; retaining an encoded ID would make a person fail to reopen, and copying requested effort instead of Pi's effective effort would change that person's mind later.
Coupled: components/organization/src/session-role.ts, components/shared/src/model-profiles.ts
Verify: components/organization/tests/roles.test.ts, components/organization/tests/catalog.test.ts
