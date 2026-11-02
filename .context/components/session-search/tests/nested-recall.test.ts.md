## file

Exercise nested recall through real native executeTool dispatch, with both issuer-only and historical-evidence searches. Check successful outer results and the historical source address/body at each nesting depth.

Why: an always-empty search passes an issuer-only negative test. Native dispatch also converts nested failures into tool results, so a completed prompt alone does not prove the recall request succeeded.

Coupled: components/session-search/src/tool.ts, tests/helpers/faux-session.ts
Verify: components/session-search/tests/nested-recall.test.ts
