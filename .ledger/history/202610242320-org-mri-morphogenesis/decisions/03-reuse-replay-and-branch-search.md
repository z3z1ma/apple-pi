Type: research
Status: resolved
Blocked by: 

## Question

What can organizational episodes and controlled organization experiments reuse from the shelved repository-history-replay task (`history.json`, REM `spec.md`, `notes.md`) and from `branch-search` (`docs/branch-search.md`)? Where would a second episode store or experiment runner duplicate them?

## Answer

Episodes can anchor on the ledger bundle and `history.json` (session ids only today) and be derived by joining the session-state database on task id; a separate episode store would duplicate task identity and session pointers. REM is shelved design only; its scorecard (gate plus turns, corrections, cost) is input to what "better" means. `search_branches` forks one conversation per attempt and blocks workplace and delegation tools, so it cannot run team experiments; those need a new runner or a `pi_exec` program over peers. Findings: [research/03-reuse-replay-and-branch-search.md](../research/03-reuse-replay-and-branch-search.md).
