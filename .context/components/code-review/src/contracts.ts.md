## file

The operator bounds concurrent reviewer passes; reviews themselves run one at a time. Standard depth uses the balanced profile; deep uses the deep profile. Plans recorded before scopes were paths name region IDs per chunk and list unowned regions as gaps. A scope path names a file or a directory prefix; `.` names the whole change. The runtime, not the planner, maps changed regions to scopes. Regions no focused scope covers are still covered by the integration pass, which reads the whole change. Plan validation checks identities, roles, and requested lenses only; how many passes a scope needs is the planner's judgment, not a runtime rule. A validator that sees one report may name findings by bare IDs. Parallel validators each settle one report; a merge then links duplicates, and that merged result is one validation checked against every report. A reused merge attempt stores its combined result and is checked again as that single validation.
Why: treating planner judgment as a runtime quota, or treating a legacy gap as current unassigned work, would reject plans the operator already accepted.

## symbol:reviewReportSchema

Generate the peer-facing report schema per assigned pass, constraining coverage questions to planned IDs without mutating ReviewReportSchema. The static schema remains the stored report shape; validateReport still enforces exact coverage and evidence.
Why: reviewers returned English question text in coverage[].question because the generic return schema permitted any string. Semantic validation then rejected a completed turn and the queue cancelled its other passes. Rejecting the value at the return-tool boundary lets the reviewer correct it within the same turn. Keep IDs rather than accepting question text, which can be duplicated or edited.

Coupled: components/session-state/src/review-jobs.ts
Verify: components/code-review/tests/contracts.test.ts, components/session-state/tests/review-queue.test.ts, components/session-state/tests/peer-turns.test.ts

## symbol:checkShape

Keep schema helpers generic over TypeBox's `TSchema`, with `Static<T>` as the result type.

Why: In the installed TypeBox 1.3.27, `Value.Check` ends with a context-aware overload whose first parameter is `TProperties`. `Parameters<typeof Value.Check>[0]` therefore selects that context type, not the schema type. Runtime tests passed with that signature while TypeScript rejected ordinary object schemas. Check this contract with `npm run typecheck` alongside behavioral tests.

Verify: tsconfig.json, components/code-review/tests/contracts.test.ts
