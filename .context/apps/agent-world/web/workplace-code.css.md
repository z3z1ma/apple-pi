## file

Keep the center pane's grid/flex ancestors shrinkable and its retained Monaco host measurable when editing becomes visible again. Git status stays in the side pane, while its read-only unified diff fills the center pane and owns its own bounded scroll area. Explicit hidden rules override the editor view's flex display without unmounting it.
Why: Monaco sizes itself from its host. Intrinsic minimum sizes in an ancestor can make a long tree or diff stretch the whole Workplace instead of scrolling within the pane. The separate center preview gives patches useful reading width while preserving the selected file and draft.

Coupled: apps/agent-world/web/workplace-code.tsx, apps/agent-world/web/workplace-git.css, apps/agent-world/web/workplace.css
Verify: apps/agent-world/tests/world-code.test.ts
