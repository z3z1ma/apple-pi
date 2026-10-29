## file

The dock is a child of the central Code editor pane, not a row under the full Files/editor/Git grid. Its finite open height takes space only from the editor/diff area; sidebar heights stay unchanged. Hidden hosts remain mounted but provide no visible bounds, so the component skips resize while hidden. Reuse Workplace's --wp-border token; there is no --wp-line token.
Coupled: apps/agent-world/web/workplace-terminal.tsx, apps/agent-world/web/workplace-code.css, apps/agent-world/web/workplace.css
Verify: apps/agent-world/tests/world-terminal.test.ts
