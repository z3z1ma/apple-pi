# 05: The capability steward proposes programs

**What to build:** Extend the steward to find repeated, costly procedures (the same tool-call sequence across sessions since codemode replaced `pi_exec`, or the same investigation rebuilt by several people), draft a saved program for one, have a peer look for inputs where it returns less than the ordinary path, measure it with paired runs, and bring it to sign-off.

**Blocked by:** 03, 04

**Status:** done

The role charter carries the program step; the acceptance run (Mateo Owusu, `report-v2.md` of task `work-f3ba1bd5`) found no recurring costly procedure that justified a program, so no paired comparison was spent.

- [x] Candidate procedures were counted from the last change to the program surface (`daad00a8`, 2026-11-04); the only saved program had one call in that window.
- [ ] Not exercised: no program bundle was produced, because none was justified; the paired-run path is covered by `compare_program`'s tests (ticket 04).
- [x] The run reported that no program was proposed, with its evidence and its limits (session_evidence does not see ordinary successful tool sequences).
