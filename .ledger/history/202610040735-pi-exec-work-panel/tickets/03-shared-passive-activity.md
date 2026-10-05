# 03: Unify passive Pi Exec activity

**What to build:** Present active Pi Exec programs alongside public subagents and managed tasks in the existing shared above-editor active-work surface. Replace the separate Pi Exec widget and represent each program as one unit of active work, including saved programs. When it settles, remove its passive activity while preserving its focused inspection from ticket 01. This slice can be demonstrated with ordinary host-call scripts and does not depend on ticket 02's live worker drill-down. Follow the parent [specification](../spec.md) and its confirmed automated execution-to-panel and real fullscreen Pi test seams. Before writing or editing tests, obtain fresh confirmation of those seams for this implementation.

**Blocked by:** [01 — Inspect program invocations and host calls](01-program-inspection.md).

**Status:** done

**Completion:** `f37f281`. Closed by operator request; the task outcome records validation results and the unresolved full-suite cancellation-test failure.

- [x] With a Pi Exec script active alongside a public subagent and a managed task, the shared above-editor active-work surface presents all three kinds of work through its existing width/height behavior. Pi Exec no longer mounts a separate activity widget alongside that surface.
- [x] The active program's passive entry identifies the invocation and updates its observed activity/timing while host calls progress. Direct snippets and saved `program_*` executions both participate without opening or focusing the work panel automatically.
- [x] A program running multiple model workers contributes one program unit to passive active-work presentation, not one public-agent entry per worker. Concurrent public agents and managed tasks retain their own activity and counts.
- [x] On success, failure, abort, or timeout, the program leaves passive active work while its outcome and available result/trace remain inspectable in Ctrl+W. Other active agents or managed tasks remain visible; if none remain, no stale active-program entry persists.
- [x] Session/branch lifecycle cleanup removes passive Pi Exec activity from the old context, and delayed updates from that context cannot restore it or overwrite current activity.
- [x] Automated integration checks render the shared passive surface during an active script and after settlement, including mixed-domain activity, saved programs, program-level worker ownership, and absence of the duplicate widget. Relevant active-work and execution regressions, formatting/lint, typecheck, package-loading and inclusion checks have recorded outcomes, with pre-existing failures identified separately.
- [x] A real fullscreen Pi check demonstrates one shared passive surface during script execution, intact editor input and Ctrl+W inspection, and removal of only the program's passive activity on settlement. User-facing documentation describes Pi Exec's shared passive activity and no longer describes a separate Pi Exec widget as the current behavior.
