# Reuse: the replay lane and branch search

An explore intern read the sources on 2026-10-24. The root checked the two decisive claims: the blocked-tool list in `components/branch-search/src/orchestrator.ts` (it includes `hire`, `rehire`, `send_mail`, `explore`), and the `history.json` shape in `components/shared/src/ledger-files.ts:43` (`{ id, linkedAt, via }`).

## What exists in code today

- **Ledger `history.json`** (`components/shared/src/ledger-files.ts`, wired by `extensions/ledger.ts`): session ids only, each with `linkedAt` and `via` (`ledger_add`, `ledger_status`, `edit`). The start and close commits from the replay task's step 1 were removed when that task was shelved (`notes.md` section 12). `components/history-eval/` was removed too.
- **REM** (`.ledger/202610041515-repository-history-replay/spec.md`): shelved design only. Replay versus paid re-simulation, an oracle-test gate, a scorecard (turns, corrections, cost, convention findings), and a simulated user.
- **`search_branches`** (`components/branch-search/`): parallel attempts in worktrees with gates, judges, cancellation, and a `record.json` per search (goal, attempts, diffs, cost, outcome). Each attempt is a **fork of one parent conversation**, and the orchestrator **blocks workplace and delegation tools**. It cannot run teams, different people, or different topologies.

## Implications for this map

- **Episodes:** the ledger bundle plus `history.json` is the natural anchor (task identity and session pointers already exist). A separate episode store that repeats task identity and session pointers would duplicate it. What is missing is everything organizational: people and roles, topology, coordination, interventions, verification, delivery time, regressions. Most of that is in the session-state database already (assignments, threads, manager changes), so an episode can be a **derived view** joined by task id rather than a stored record.
- **Controlled organization experiments:** branch search's worktree, gate, and judge machinery is reusable for code-level comparison, but a team experiment needs orchestration it does not have (several people, roles, topology, coordination) and its model forbids it. That is a new runner or a `pi_exec` program over peers, and it stays in the fog until the earlier phases show it is needed.
- **REM's scorecard** (gate plus turns, corrections, cost) is the closest existing answer to "what does a verified outcome cost", and is input to the ticket on what "better" means.
