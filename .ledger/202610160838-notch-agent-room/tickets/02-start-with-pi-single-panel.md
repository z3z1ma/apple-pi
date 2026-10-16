# 02: Starts with pi, one panel per Mac, updates on source change

**What to build:** A root pi session start inside tmux on macOS starts the notch panel with no manual step. Every tmux server shares one panel. After the Swift source changes, the next root pi session start replaces the running panel with the new build. The panel ships in the package and is documented for users. The single-instance lock, the takeover of an older build, and the start from the tmux-sessions extension are described in `plan.md` under Start and One panel per Mac.

**Blocked by:** 01 (Notch panel runs from the component, started by hand)

**Status:** done

- [x] A root pi session start in tmux on macOS starts the panel. A start outside tmux, a child session, or a start on Linux does not.
- [x] Root pi sessions in two tmux servers give exactly one panel process.
- [x] After a Swift source edit, the next root pi session start replaces the panel: a new pid and a new build hash in the lock file.
- [x] After `kill -9` of the panel, the next root pi session start brings it back. The lock file is opened close-on-exec, so a surviving feed child does not keep the lock.
- [x] A failing notch start does not stop status publishing (Vitest).
- [x] `npm run pack:check` lists the Swift shell and the web page with its assets, and does not list the art sources or the art pipeline.
- [x] `docs/tmux-sessions.md` has a Notch section covering requirements (macOS, Xcode command line tools, uv), start-up, and adding art with `generate_image` or `codex exec` plus the cleanup script. The README catalog and the tmux-sessions row of AGENTS.md mention the notch.
