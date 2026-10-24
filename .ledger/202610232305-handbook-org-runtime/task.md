Status: planning
Created: 2026-10-23
Updated: 2026-10-23

# Organization runtime for the handbook model

## Intent

The skills are being rewritten as the organization's handbook: processes run by standing people, with the coordinator as their permanent home (see `docs/organization.md#processes` and `skills/handbook-writing/`). Planning that rewrite with the operator exposed these runtime gaps:

1. **`<manager>` guidance for unroled roots.** `components/organization/src/install.ts` adds the `<manager>` charter only when `role.manages`; an unroled root holds the manager tools and catalog without the team guidance. Give every session that holds the manager tools the charter.
2. **Working sessions report to the coordinator by default.** Each new operator session is its own root, so it cannot see or `assign` the coordinator's standing people. Decide how operator sessions join the coordinator's organization (default `--reports-to coordinator`, a setting, or another mechanism) and what happens when no coordinator exists.
3. **Sign-off tool names.** Done: the tools are `sign_off_code`, `sign_off_document`, and `sign_off_task`; `explain_change` keeps its name.
4. **Markdown and pictures in code sign-off.** Done: `sign_off_code` renders full Markdown, including Mermaid, in its intent, focus text, and chapter briefs, and its guidance says where a picture belongs.
5. **Program peers have no working directory.** `pi_exec` `agent_run` and `peer` take no `cwd`, so temporary peers always start in the caller's repository; a Ralph loop or any program cannot staff work in another repository or worktree. Found in the Ralph live run, 2026-10-24.

Acceptance criteria: to be settled when this task is shaped.

## Current State

Planning. Items 3 and 4 are done; items 1, 2, and 5 are ready to shape.

## Outcome

Pending shaping.
