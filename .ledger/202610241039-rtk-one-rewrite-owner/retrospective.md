Status: done
Created: 2026-10-24
Updated: 2026-10-24

# Retrospective

## What Mattered

- The design went survey, interview, Ralph, board, sign-off in one day; each step was also a live run of a revised skill.
- The cold final check of the interview and the skeptic's run without rtk on PATH each found what the main actors missed.

## Learnings

- A change whose acceptance says "when X is absent" must be tested with X absent; reviewers on a host that has X miss it.
- A guard whose removal is not observable is not a behavior defect; test behavior, not guards.

## Improvements

- agent_run has no cwd, so programs staff work only in the caller's repository (recorded in the organization runtime task).
