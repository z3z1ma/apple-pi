## file

This sheet is loaded after the world UI's layout CSS, so equal-specificity rules here win. It supplies the guild look only: carved wood, brass, parchment, and the conversation panel as an open book. Tokens come from `theme.json`.
Why: a skin that restates layout fights the shared UI. A dialog shown over the page must not move the transcript under it.
Coupled: apps/agent-workplace/web/styles.css, apps/agent-workplace/themes/fantasy/theme.json
Verify: apps/agent-workplace/tests/theme-pack.test.ts
