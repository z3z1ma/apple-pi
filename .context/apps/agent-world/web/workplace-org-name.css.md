## file

This editor is embedded in Chat's workspace heading, Org cards and focused headers, and person profiles. Keep its controls scoped to wp-org-name/wp-org-name-editor and inherit Workplace palette tokens; the embedding surface owns its layout and heading level.
Why: a shared name editor must not restyle unrelated profile fields or couple card geometry to the sidebar's heading rules. User-provided names wrap rather than becoming a fixed-width layout constraint. Normal headings have no sibling action control; the input/check/cancel grid exists only during an explicit rename and keeps controls on one row.
Coupled: apps/agent-world/web/workplace-org-name.tsx, apps/agent-world/web/workplace-org-chart.css, apps/agent-world/web/workplace.css
