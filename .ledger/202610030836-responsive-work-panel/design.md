# Direct responsive work panel

## Accepted behavior

The existing centered `/work` picker is not the intended primary experience. Replace it with one shared, non-capturing panel containing Agents and Tasks tabs. This supersedes the manual pinning entry flow from the [completed glanceable-panel task](../history/202610030008-tui-glanceable-panels/task.md); that task's archived artifacts remain historical.

“Non-capturing” means opening the panel leaves keyboard input in the main editor until focus is explicitly transferred. “Follow-tail” means the selected conversation or task output follows incoming content rather than staying at a manually chosen scroll position.

- `/work` and Ctrl+W open the panel on its last-used tab.
- `/agents` and `/tasks` open the same panel directly on their respective tabs. Repeated commands reuse the panel rather than stack overlays.
- At 120 or more terminal columns: top-right placement, 33% width, existing 70% maximum height.
- Below 120 columns: top-center placement, 50% terminal height and 90% terminal width, matching `/btw`. The control panel never disappears because of width.
- Resize preserves tab, selected record, scroll, follow-tail state, and steering draft.
- Agents expose the existing roster and live conversation in this panel without an intermediate picker or pin step. Tasks retain their management and inspection capabilities.
- Editor input stays available; Alt+G transfers focus, Esc returns to the editor, and q closes the panel when not composing. Mouse focus and scrolling remain available.
- Retain the established memory-only UI state and agent lifetime rules. This is a layout/entry-point change, not a persistence change.

## Confirmed validation seams

The operator approved these seams for this implementation:

1. Work-manager command tests: shared instance, direct tab aliases, last-used tab and lifecycle. Fast automated feedback; no real terminal rendering proof.
2. Integrated agent/task panel tests: controls, focus transfer, and preserved state across tab switches and resize. Fast fake-TUI feedback; does not establish real cursor/overlay behavior.
3. Real fullscreen Pi via tmux: wide/narrow placement, editor typing, agent steering, task inspection, focus return, and closing. Slower integration proof.

Use red-to-green behavioral tests at these seams. Update product documentation to describe direct opening rather than manual pinning. Run the repository checks and review the final change. The follow-up authorizes implementation and validation, not task closure, archive, or commit. After validation, record results in [task.md](task.md) and ask the operator for sign-off and any commit or closure authority.
