# Scoped Re-Review Prompt Template

Use this template as `ledger-pi-review` worker guidance after a fix round. The re-reviewer verifies the findings against the current BASE-to-worktree package and checks the amended paths for new breakage. It is not a fresh review — the full review already happened.

**Purpose:** Verify each finding from the previous review was addressed, and
that the fix itself broke nothing.

```
`ledger-pi-review` worker guidance:
  description: "Re-review WI-### fix round R"
  profile: [PROFILE — REQUIRED: choose per SKILL.md Model Selection]
  prompt: |
    You are re-reviewing one task's fix round. A previous review produced
    findings; an implementer has attempted to fix them. Your job is to
    verdict each finding and inspect the fix diff — nothing else.

    ## The Task

    Read the task brief: [BRIEF_FILE]

    ## The Findings Under Verification

    [FINDINGS]

    ## The Fix

    Read the implementer's report (fix reports are appended at the end):
    [REPORT_FILE]

    **Work Item boundary:** [BASE_SHA]..WORKTREE
    **Diff file:** [DIFF_FILE]

    Read the diff file once — it contains tracked status and patches plus every non-ignored untracked file patch, including binary patches. Use the findings and the appended fix report to focus on the amended paths. Do not re-run git commands.

    If the package is missing or unreadable, report the evidence gap to the controller. The controller regenerates it with `scripts/review-package PLAN_FILE [BASE_SHA]`; a plain `git diff` is not an equivalent fallback because it omits untracked files.

    Your review is read-only on this checkout. Do not mutate the working
    tree, the index, HEAD, or branch state in any way.

    ## You Do Not Dispatch Subagents

    Do all of this review yourself. Never spawn a subagent to review part
    of the diff, and never spawn another reviewer for a second opinion.
    This process already provides every review seat the work gets; a
    reviewer you spawn duplicates one of them at full cost, and its
    verdict counts for nothing. If the diff feels too large for one
    pass, review it in passes yourself and say so in your report.

    ## Scope

    Your scope is the findings list and the paths named in the appended fix report. Verdict every finding. Inspect those amended paths for new problems the fix introduced. Do NOT re-review other parts of the BASE-to-worktree package: report unrelated observations under Out-of-Scope Observations — they do not block this Work Item or extend the loop. A broad
    whole-branch review happens after all tasks are complete.

    ## Tests

    The implementer re-ran the tests covering the amended code and appended
    the results to the report file. Treat the report as unverified claims:
    confirm the fix report names the covering tests and shows their output,
    and verify the claims against the diff. Do not re-run the suite to
    confirm their report. Run a test only when reading the code raises a
    specific doubt that no existing run answers — and then a focused test,
    never a package-wide suite.

    ## Output Format

    Your final message is the report itself: begin directly with the first
    finding's verdict. Every line is a verdict, a finding with file:line,
    or a check you ran — no preamble, no process narration.

    ### Finding Verdicts

    For each finding in The Findings Under Verification, in order:
    - **[finding one-liner]** — ADDRESSED | NOT ADDRESSED, with file:line
      evidence. "Attempted" is not addressed: the specific defect must no
      longer exist.

    ### New Breakage in the Fix Diff

    Anything the fix itself broke or introduced, with severity
    (Critical/Important/Minor) and file:line. "None" if clean.

    ### Out-of-Scope Observations

    Issues you noticed entirely outside the fix diff. Non-blocking; the
    controller ledgers these for the final review. "None" if none.

    ### Verdict

    **Fix round:** [All findings addressed, no new Critical/Important
    breakage | Findings remain open] — list the open ones.
```

**Placeholders:**
- `[PROFILE]` — REQUIRED: reviewer profile per SKILL.md Model Selection; scoped re-reviews of small fix diffs take a quick-to-balanced profile
- `[BRIEF_FILE]` — the task brief file (same file the implementer worked from)
- `[FINDINGS]` — the Critical/Important findings and spec gaps from the
  previous review, copied verbatim, one per bullet
- `[REPORT_FILE]` — the implementer's report file (fix reports appended)
- `[BASE_SHA]` — the worktree comparison boundary recorded before this Work Item
- `[DIFF_FILE]` — the path `scripts/review-package PLAN_FILE BASE` printed

**Re-reviewer returns:** per-finding verdicts (ADDRESSED / NOT ADDRESSED),
new breakage in the fix diff, out-of-scope observations, and a round verdict.
