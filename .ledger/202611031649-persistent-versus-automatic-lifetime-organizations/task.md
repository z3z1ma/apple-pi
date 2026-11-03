Status: planning
Created: 2026-10-30

# Define persistent versus automatic-lifetime organizations

## Intent

Design and implement an explicit Pi startup flag for lasting organizations, with new unflagged sessions and their descendant organizations cleaned up automatically after their root closes. Preserve existing stored people as persistent through migration. First trace current session/process ownership, peer cleanup, departure safeguards and Pi flag registration; settle ambiguous lifetime and cleanup semantics with the operator before changing irreversible runtime authority. Acceptance: agreed flag/ownership contract, crash-safe and restart-safe cleanup with explicit live-process handling, grandfathered existing rows, focused behavioral verification, docs and runtime prompt guidance, committed build and appropriate activation.

## Outcome

Pending completion.
