## file

The panel compiles on the operator's machine at first start, so a launcher that no longer compiles fails here before a user sees it.
Why: the test PATH holds only the tools the launcher needs, so the real `swiftc` cannot satisfy the build. Pi itself runs inside one tmux server; the panel serves every server and must not inherit that one.
