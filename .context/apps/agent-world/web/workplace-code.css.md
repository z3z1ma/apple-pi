## file

Keep the center pane's grid/flex ancestors shrinkable and its retained Monaco host measurable when editing becomes visible again. The editor or read-only unified diff uses the remaining center space above the retained terminal; Files and Git keep the grid's full height. Each content pane owns its bounded scrolling. Explicit hidden rules override the editor view's flex display without unmounting it.
Why: Monaco sizes itself from its host. Intrinsic minimum sizes can make a long tree or diff stretch the whole Workplace instead of scrolling within its pane. Docking the terminal after the whole grid, rather than inside the center pane, would also shrink both navigation sidebars.

Tree rows reserve separate fixed SVG slots for the disclosure chevron and file/folder icon, then shrink only the filename. The selected row and keyboard focus stay visible inside the scrolling file pane. Tab activation and close are sibling buttons, with selection styling on their wrapper.
Why: nested buttons break keyboard activation, and letting a long filename grow an icon slot or flex minimum pushes navigation outside the fixed sidebar.

Coupled: apps/agent-world/web/workplace-code.tsx, apps/agent-world/web/workplace-icon.tsx, apps/agent-world/web/workplace-git.css, apps/agent-world/web/workplace-terminal.css, apps/agent-world/web/workplace.css
Verify: apps/agent-world/tests/world-code.test.ts, apps/agent-world/tests/world-terminal.test.ts
