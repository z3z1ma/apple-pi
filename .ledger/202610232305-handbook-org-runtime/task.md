Status: planning
Created: 2026-10-23
Updated: 2026-10-23

# Organization runtime for the handbook model

## Intent

The skills are being rewritten as the organization's handbook: processes run by standing people, with the coordinator as their permanent home (see `docs/organization.md#processes` and `skills/handbook-writing/`). Three runtime gaps came out of that interview:

1. **`<manager>` guidance for unroled roots.** `components/organization/src/install.ts` adds the `<manager>` charter only when `role.manages`; an unroled root holds the manager tools and catalog without the team guidance. Give every session that holds the manager tools the charter.
2. **Working sessions report to the coordinator by default.** Each new operator session is its own root, so it cannot see or `assign` the coordinator's standing people. Decide how operator sessions join the coordinator's organization (default `--reports-to coordinator`, a setting, or another mechanism) and what happens when no coordinator exists.
3. **Plain workplace tool names.** Rename browser tools (`review_code`, `review_markdown`, `review_ledger_task`, `explain_change`, possibly `ask_user_question`) to plain workplace words a colleague would use. Names are added here as each matching skill comes up in the skill pass.

Acceptance criteria: to be settled when this task is shaped.

## Current State

Planning. Items 1 and 2 are ready to shape; item 3 grows during the skill pass.

## Outcome

Pending shaping.
