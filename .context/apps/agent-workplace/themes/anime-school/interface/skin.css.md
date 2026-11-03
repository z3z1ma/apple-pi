## file

This sheet is loaded after the world UI's layout CSS, so equal-specificity rules here win. It supplies the school-notebook look only. The conversation panel is an open notebook, not a second layout.
Why: a skin that restates layout fights the shared UI.
Coupled: apps/agent-workplace/web/styles.css, apps/agent-workplace/themes/anime-school/theme.json
Verify: apps/agent-workplace/tests/theme-pack.test.ts
