## file

This sheet is loaded after the world UI's layout CSS, so equal-specificity rules here win. Tokens come from `theme.json`; the shades in this sheet are its own. The conversation panel is a document window, not a second layout.
Why: a skin that restates layout fights the shared UI. It only supplies the office look.
Coupled: apps/agent-workplace/web/styles.css, apps/agent-workplace/themes/tech-office/theme.json
Verify: apps/agent-workplace/tests/theme-pack.test.ts
