## file

This glyph set is shared by shell navigation and pane actions, without importing the shell's store initialization into those consumers. Icons stay decorative; the owning control supplies its accessible action name and tooltip. The shared button treatment lives in workplace.css and must keep action affordances visible before hover.
Why: moving a glyph out of the shell must not introduce a circular import or execute shell setup from an editor component. Removing visible action text saves space only if keyboard and assistive-technology users still receive the action's meaning.
Coupled: apps/agent-workplace/web/workplace.tsx, apps/agent-workplace/web/workplace.css, apps/agent-workplace/web/workplace-code.tsx, apps/agent-workplace/web/workplace-git.tsx, apps/agent-workplace/web/workplace-issues.tsx
Verify: apps/agent-workplace/tests/world-code.test.ts, apps/agent-workplace/tests/world-issues.test.ts
