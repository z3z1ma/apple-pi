## symbol:openGitHub

`gh search prs` returns no head branch or checks, so each searched pull request not already found by an agent's branch is read again with `gh pr view --json headRefName,statusCheckRollup,reviewDecision`, four at a time. An agent on its repository's default branch (from `gh repo view --json defaultBranchRef`) is not looked up.
Why: linking needs the head branch; `gh pr list --head main` would list unrelated pull requests whose head is named main in forks.
Verify: apps/agent-world/tests/integrations/github.test.ts

## symbol:ciRollup

Any failed check (check run conclusions FAILURE, TIMED_OUT, CANCELLED, ACTION_REQUIRED, STARTUP_FAILURE; statuses FAILURE, ERROR) makes the pull request failing even while others still run; NEUTRAL, SKIPPED, and STALE count toward passing only as "not failing"; no checks at all is `none`.
Why: the forge's quench shows trouble as soon as it is certain, as `gh pr checks` does.
Verify: apps/agent-world/tests/integrations/github.test.ts
