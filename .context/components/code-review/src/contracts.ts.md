## file

The operator bounds concurrent reviewer passes; reviews themselves run one at a time. Standard depth uses the balanced profile; deep uses the deep profile. Plans recorded before scopes were paths name region IDs per chunk and list unowned regions as gaps. A scope path names a file or a directory prefix; `.` names the whole change. The runtime, not the planner, maps changed regions to scopes. Regions no focused scope covers are still covered by the integration pass, which reads the whole change. Plan validation checks identities, roles, and requested lenses only; how many passes a scope needs is the planner's judgment, not a runtime rule.
Why: treating planner judgment as a runtime quota, or treating a legacy gap as current unassigned work, would reject plans the operator already accepted.

The stored shapes (`ReviewPlanSchema`, `ReviewReportSchema`, `DuplicateLinksSchema`) are what the runtime keeps. Reviewers answer through per-attempt tool schemas instead (`planToolSchema`, `reportToolSchema`, `duplicateToolSchema`): roles, question IDs and finding keys are literal choices, each planned question is a required key of `coverage` with a union that requires evidence for completed and a reason otherwise, and the artifact and pass are absent because the `*FromTool` converters add them. Pi validates tool arguments inside the reviewer's turn, so a wrong ID or a missing answer comes back to the model as an error it can fix.
Why: 4 of the first 5 failed reviews died after the turn on an ID the model invented or echoed wrongly (an extra "standards and intent" question, a gap naming question text, another artifact digest); the strict post-turn checks had no way to let the model correct it.

`assessFindings` derives each finding's status from the reports and the optional duplicate links: confirmed or probable findings stand as confirmed, hypotheses stay unresolved, and a link applies only when both keys exist and it creates no self-link or cycle. Stored validations from before this change (with per-finding dispositions and coverage gaps) are read as they are. `literals()` maps an array to a union, so these tool schemas have no useful static type; their values go through `unknown` and the converters.
Why: per-report validators confirmed 106 of 106 findings across 61 runs and only added coverage gaps; the status they gave is what the reports already say.

## symbol:checkShape

Keep schema helpers generic over TypeBox's `TSchema`, with `Static<T>` as the result type.

Why: In the installed TypeBox 1.3.27, `Value.Check` ends with a context-aware overload whose first parameter is `TProperties`. `Parameters<typeof Value.Check>[0]` therefore selects that context type, not the schema type. Runtime tests passed with that signature while TypeScript rejected ordinary object schemas. Check this contract with `npm run typecheck` alongside behavioral tests.

Verify: tsconfig.json, components/code-review/tests/contracts.test.ts
