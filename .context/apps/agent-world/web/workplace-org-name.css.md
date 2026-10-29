## file

This editor is embedded in Chat's workspace heading, Org cards and focused headers, and person profiles. Keep its controls scoped to wp-org-name/wp-org-name-editor and inherit Workplace palette tokens; the embedding surface owns its layout and heading level.
User-provided names wrap rather than becoming a fixed-width layout constraint. Actual organization work buttons inherit the containing heading's typography and wrap its full label, with pointer/underline and focus affordances; workspace/profile rename-only headings retain their existing behavior. Normal headings have no sibling action control; the input/check/cancel grid exists only during an explicit rename and keeps controls on one row.
Why: the same name control appears in differently sized card/header surfaces. Inherited typography and scoped selectors preserve those layouts without restyling unrelated profile fields.
Coupled: apps/agent-world/web/workplace-org-name.tsx, apps/agent-world/web/workplace-org-chart.css, apps/agent-world/web/workplace.css
Verify: apps/agent-world/tests/world-org.test.ts
