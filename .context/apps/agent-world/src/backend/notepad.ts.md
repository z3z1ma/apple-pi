## symbol:openNotepads

The renderer names only a coordinator id; the file path is always derived here from that running coordinator's `cwd`, never taken from IPC arguments.
Why: the window shows untrusted transcript text, so a renderer-supplied path would let it read or write any file the main process can.
Coupled: apps/agent-world/src/electron/main.ts

`save` writes only when the file still holds `base`, and a save of ours updates the watched text so the watcher does not report it back. The panel depends on both: it replaces its text on a change only when it has no unsaved edits, and otherwise shows "Load the file / Keep mine".
Why: agents edit `NOTES.md` while the operator types; without the base check an autosave would silently overwrite an agent's update, and an echoed own save would read as a change on disk.
Coupled: apps/agent-world/web/overlay/places/notepad.tsx
Verify: apps/agent-world/tests/notepad.test.ts, apps/agent-world/tests/world-notepad.test.ts
