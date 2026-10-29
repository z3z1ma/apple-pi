## file

Mount this picker only after an explicit Files search action or active-Code Cmd/Ctrl+P. Opening the picker requests its selected directory's filename list; replacing that root invalidates the old request. Query changes rank the local list without another filename request or file-content read. Results retain the file-list root/path basis, not the canonical Git top-level returned by worktree discovery. The Code owner performs the guarded file open after selection and restores editor focus after it completes.
Why: metadata discovery must not become implicit file-content access or substitute the wrong root for a manually opened subdirectory. A fresh explicit opening sees changed filenames without a second persistent index or watcher.

The input owns keyboard selection through aria-activedescendant; all matches stay in a bounded scrolling list. Escape/close restores a still-visible prior trigger, outside dismissal preserves the external focus decision, and result selection leaves editor focus to Code. Fetch completion is ignored after unmount/root replacement.
Why: retained Code views receive unrelated world snapshots, and neither an old request nor focus cleanup should reopen a hidden picker or steal focus from another Workplace view.

The shared context-menu owner dismisses its popup without restoring focus when the picker takes focus. Keep that transition in the shared owner rather than adding a second menu state or a picker-specific dismissal API.
Why: Cmd/Ctrl+P can open the picker while a context-menu item has focus. Mounting the picker does not reset the provider's retained menu state, and restoring its trigger would steal focus from the new input.

Coupled: apps/agent-world/web/workplace-code.tsx, apps/agent-world/web/workplace-code.css, apps/agent-world/web/workplace-context-menu.tsx, apps/agent-world/src/workspace.ts
Verify: apps/agent-world/tests/world-code.test.ts
