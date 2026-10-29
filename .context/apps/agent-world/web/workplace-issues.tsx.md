## file

Issues reuses the existing IntegrationsApi Jira adapter, sign-in storage and outside-write gate. The first activation reads credentials and assigned issues. Search scope and submitted query stay in component state; typing alone makes no search request. Hiding the tab keeps the query and selection; merely mounting a hidden tab makes no Jira request. Each explicitly opened issue detail stays mounted while hidden, retaining its recipient/goal and receipt observer across issue selection, detail closure and tab changes; inactive panels cancel unsent write confirmations. Description and comments reuse RichView and its existing safeHtml allowlist, falling back to escaped plain text. Workplace supplies RichView's link callback through openLink rather than World's unconnected Atlassian singleton. No unsanitized DTO HTML reaches the page and images remain named placeholders. All external links go through openLink.
Why: Workplace adds a view of the existing integration, not another credential handler, direct HTTP client or issue store.

Coupled: apps/agent-world/src/integrations.ts, apps/agent-world/src/backend/integrations/jira.ts, apps/agent-world/web/workplace.tsx
Verify: apps/agent-world/tests/world-issues.test.ts

## symbol:WorkplaceIssues

The editable `query`, submitted `search` and explicit `mine`/`all` scope represent different user choices. My issues clears both query values. Search all with no submitted query shows the search prompt instead of requesting assigned issues or an empty global search. Submitting a query searches across accessible Jira issues; submitting the same query again still refreshes it. The effect's lifetime check prevents a superseded credential or list response from replacing the current scope's result. Opened detail panels remain independent of the list so changing scope preserves their drafts and does not change a delegation target.
Why: deriving the scope from search text alone cannot distinguish My issues from an empty Search all view. Combining draft and submitted text would turn typing into network requests; removing the explicit refresh would make repeated submissions of the same text a no-op.
Verify: apps/agent-world/tests/world-issues.test.ts

## symbol:DelegateIssue

Recipients are actual awake character IDs. Team-head labels come from recorded headquarters and reporting edges; there is no coordinator fallback or default recipient. An explicit goal accompanies the issue identity/link through the existing delegate command. The textarea's 4,000-character limit matches the existing delegation backend's NOTE_MAX truncation boundary, preventing an operator from writing context the backend would silently discard. Receipt observation begins before dispatch, filters by command ID, and ends at unmount. A late successful delegate response leaves an already-observed receipt intact; a refusal or exception still reports its failure. Accepted, delivered and applied describe instruction delivery, never completion of issue work or a Jira assignment. Inputs lock after a submitted instruction until failure, keeping repeated submits from issuing duplicate work. The native Delegate disclosure hides rather than unmounts the form, so collapsing it preserves both draft and receipt observation.
Why: handing an issue to a team means asking its real head, and runtime command acceptance is not proof that the task was completed.

Coupled: apps/agent-world/src/backend/integrations/delegation.ts, apps/agent-world/src/world.ts

## symbol:IssueTransitions

The existing useOutsideWrite hook retains the described intent/token pair and performs the sole confirmWrite call after explicit confirmation. A native dialog owns keyboard focus; cancellation sends nothing, and hiding the Issues tab cancels an unsent confirmation. An already-sending write is not claimed cancelled. Successful writes refresh both detail and current list.
Why: changing a Jira status is an external action under the operator's account, not a local optimistic state update.

Coupled: apps/agent-world/web/overlay/places/outside-write.tsx, apps/agent-world/src/backend/integrations/gate.ts
