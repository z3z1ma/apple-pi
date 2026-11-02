## file

The dock is a child of the central Code editor pane, not a row under the full Files/editor/Git grid. Its finite open height takes space only from the editor/diff area; sidebar heights stay unchanged. Hidden hosts remain mounted but provide no visible bounds, so the component skips resize while hidden. Reuse Workplace's --wp-border token; there is no --wp-line token.
Coupled: apps/agent-workplace/web/workplace-terminal.tsx, apps/agent-workplace/web/workplace-code.css, apps/agent-workplace/web/workplace.css
Verify: apps/agent-workplace/tests/world-terminal.test.ts
