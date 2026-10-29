## file

These tests launch only clean shells under temporary directories with isolated HOME/ENV/SHELL and dispose the collection after every test. Shell output reports its own PID and its normal foreground child's PID; liveness after close/closeAll/dispose is checked only for those recorded owned processes. No live Pi runtime, tmux server or arbitrary process matching is used. The macOS login test writes only synthetic .zprofile/.zshrc under temporary HOME/ZDOTDIR and waits for natural shell exit before removing the directory; immediate deletion after hangup can race shell shutdown files. Environment filtering is checked with synthetic terminal identities and one retained ordinary value, not a dump of inherited authentication/configuration.

Independent-session coverage uses different seed directories and checks each shell's actual newline-delimited pwd output after a duplicate-identity create is refused. Invalid-input coverage asserts the returned rejection, not an immediate empty event list as proof of process absence.
Why: two shells seeded in the same directory cannot expose shared-directory state, and output events arrive asynchronously after native spawning. Neither identical fixtures nor a synchronous empty queue establishes the claimed behavior.

The test proves normal hangup cleanup, not termination of deliberately detached/nohup jobs. Cleanup deliberately follows ordinary terminal hangup semantics; process-descendant scavenging would cross that ownership boundary and race PID reuse. Node-native passing tests do not establish Electron ABI/loading, preload routing, CSP or renderer lifetime; the actual built Electron check owns those seams.
Coupled: apps/agent-world/src/backend/embedded-terminal.ts, apps/agent-world/src/terminal.ts
