# 02: Build the first-class subagent manager

**What to build:** Upgrade `/agents` into a polished, keyboard-navigable management flow for public top-level subagents. The roster must expose useful live state, open the selected agent's conversation for inspection, preserve steering and confirmed stopping, and retain access to discovered agent-type information without restoring any below-editor navigation.

**Blocked by:** 01: Move subagent activity above the editor

**Status:** done

- [x] `/agents` opens a focused roster whose rows distinguish running, queued, and recently settled public top-level agents with their identity, description, activity, elapsed time, and useful usage state.
- [x] Internal and nested agents remain absent from the roster and unavailable through its inspect, steer, and stop actions.
- [x] Selecting an agent opens its live or final conversation; closing the detail view returns to the same agent when it still exists, even if the roster changed while the view was open.
- [x] Running or queued agents can be steered and can be stopped only after explicit confirmation; settled agents remain readable without offering invalid actions.
- [x] The manager continues to provide an inspectable view of discovered built-in and Markdown agent types.
- [x] Navigation follows configured selection keybindings, does not steal input from unrelated focused dialogs, stays bounded by terminal width and height, and cleans up overlays and subscriptions on session lifecycle changes.
- [x] Rendered action hints, user documentation, and behavioral tests agree on the available navigation, steering, stopping, and close controls.
