Status: complete
Created: 2026-11-06
Updated: 2026-11-06

# Retrospective

## What Mattered

- Asking before building paid off: the cross-workspace thread rule, the single desk that is active in one workspace, guidance-only worker selection and the scope of the temp badge were all settled in two short question rounds, and none of them changed afterwards.
- One scoping point (`scopeWorld`) kept the views consistent, but scoping the data was not enough. The review found state retained across a workspace switch (Chat's opened thread and discovered channels, Mail's reader) and links from global apps that did not switch workspace. Remounting Chat and Mail per workspace fixed the first class with no new state logic.
- Splitting the work by file ownership let Niamh build worker pools in the runtime while I built the UI. The one shared file (`review-read.ts`) needed explicit hand-offs both ways.
- The review of both commits ran with an existing worker (Hye-jin) in its pool. This was the first live use of the fork path, and her fork produced real findings. It also found two real defects in the fork path itself: foreign transcripts could be copied, and inherited spend was counted again.

## Learnings

- A view that is scoped by its data still leaks through retained component state and through navigation from unscoped apps. Test a workspace switch while a reader is open, and test cross-app links, not only list contents.
- Root discovery and membership traversal must use the same parent graph. A person whose manager had departed was counted both as a root and as a member of another workspace.
- Fixture "four lasting people" counts and default-workspace choice interact: sort workspaces by lasting members, not by every recorded identity.

## Improvements

- Leaving an organization is now one menu action. The real fix, organizations that are temporary by default, is `.ledger/202611031649-persistent-versus-automatic-lifetime-organizations/` (incorporate).
