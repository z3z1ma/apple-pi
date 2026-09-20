# 04: Build the first-class managed-task manager

**What to build:** Add a polished `/tasks` management flow that uses the same roster navigation language as `/agents` and opens a task-specific detail view. Users must be able to inspect every session-local managed-task kind, follow live command output and monitor state, and explicitly cancel active work without introducing agent-only concepts such as steering.

**Blocked by:** 02: Build the first-class subagent manager; 03: Add managed tasks to active-work surfaces

**Status:** done

- [x] `/tasks` opens a focused, keyboard-navigable roster of the session's active and settled managed tasks, ordered and labeled so active work and terminal outcomes are immediately distinguishable.
- [x] Selecting a scheduled or due prompt shows its complete prompt, timing, delivery state, and available cancellation action.
- [x] Selecting a scheduled or running command shows its command, working directory, timing, PID when present, lifecycle status, exit state, and live rolling output.
- [x] Selecting a monitor additionally shows delivered events, the caller-owned event limit, and whether delivery is active, silent-until-completion, or finished.
- [x] Truncated output clearly identifies that it is incomplete and exposes the existing full-output path; a task that settles while open remains readable in its final state until the user closes it.
- [x] Active tasks can be cancelled only after explicit confirmation, cancellation uses the existing process-tree and schedule lifecycle, and settled tasks never offer an invalid cancellation action.
- [x] The roster shares navigation and visual conventions with `/agents`, while the detail view and action language remain task-specific and never offer steering, resumption, or agent metadata.
- [x] Navigation follows configured selection keybindings, remains bounded by terminal width and height, does not capture input owned by another component, and disposes overlays and subscriptions safely across all session lifecycle paths.
- [x] Rendered action hints, user documentation, and behavioral tests agree on task inspection, output navigation, cancellation, and close controls for every managed-task kind.
