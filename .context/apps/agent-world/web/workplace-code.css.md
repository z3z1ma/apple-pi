## file

Keep the center pane's grid/flex ancestors shrinkable and its retained Monaco host measurable when editing becomes visible again. Git status stays in the side pane, while its read-only unified diff fills the center pane and owns its own bounded scroll area. Explicit hidden rules override the editor view's flex display without unmounting it.
Why: Monaco sizes itself from its host. Intrinsic minimum sizes in an ancestor can make a long tree or diff stretch the whole Workplace instead of scrolling within the pane. The separate center preview gives patches useful reading width while preserving the selected file and draft.

Tree rows reserve separate fixed SVG slots for the disclosure chevron and file/folder icon, then shrink only the filename. The selected row and keyboard focus stay visible inside the scrolling file pane. Tab activation and close are sibling buttons, with selection styling on their wrapper.
Why: nested buttons break keyboard activation, and letting a long filename grow an icon slot or flex minimum pushes navigation outside the fixed sidebar.

Coupled: apps/agent-world/web/workplace-code.tsx, apps/agent-world/web/workplace-icon.tsx, apps/agent-world/web/workplace-git.css, apps/agent-world/web/workplace.css
Verify: apps/agent-world/tests/world-code.test.ts
