Status: planning
Created: 2026-10-23
Updated: 2026-10-23

# Organization runtime for the handbook model

## Intent

The skills are being rewritten as the organization's handbook: processes run by standing people, with the coordinator as their permanent home (see `docs/organization.md#processes` and `skills/handbook-writing/`). Planning that rewrite with the operator exposed these runtime gaps:

1. **`<manager>` guidance for unroled roots.** `components/organization/src/install.ts` adds the `<manager>` charter only when `role.manages`; an unroled root holds the manager tools and catalog without the team guidance. Give every session that holds the manager tools the charter.
2. **Working sessions report to the coordinator by default.** Each new operator session is its own root, so it cannot see or `assign` the coordinator's standing people. Decide how operator sessions join the coordinator's organization (default `--reports-to coordinator`, a setting, or another mechanism) and what happens when no coordinator exists.
3. **Sign-off tool names.** Operator decision: rename `review_code`, `review_markdown`, `review_ledger_task` to the `sign_off_*` family (`sign_off_code`, `sign_off_document`, `sign_off_task`), and update `skills/operator-sign-off/`, docs, and tests with them. `explain_change` keeps its name. More names may be added as later skills come up.
4. **Markdown and pictures in code sign-off.** Done: `review_code` renders full Markdown, including Mermaid, in its intent, focus text, and chapter briefs, and its guidance says where a picture belongs.

Acceptance criteria: to be settled when this task is shaped.

## Current State

Planning. Item 4 is done; items 1 and 2 are ready to shape; item 3 is decided and may gain more names as the skill pass continues.

## Outcome

Pending shaping.
