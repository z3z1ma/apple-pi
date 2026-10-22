# 08: Interns

**What to build:** `explore` (the local repository and filesystem) and `research` (external sources) are tools for every root session. Each runs one headless Pi process on the one-shot runner `pi_exec` workers use, with the intern's fixed prompt, read-only tools, and the `quick` profile, streams its current tool and argument as a live activity line, returns the final text, and exits. Esc kills the process. The descriptions frame them as a cheap intern: fast, cheap, keeps reading out of your context; a lossy summary of only what it chose to report; it can miss, misread, or state a belief as fact, so verify before acting and read the source when the detail decides. Startup latency is measured once and recorded as evidence.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] With a fake worker `pi`, `explore` returns the worker's final text, reports its tool calls as activity, and leaves no process behind.
- [ ] Aborting the tool call kills the worker process.
- [ ] Two intern calls in one assistant message run at the same time.
- [ ] Each tool's description and guidelines carry the intern framing, and the word "sense" appears in no prompt, tool, or doc.
- [ ] One startup-latency measurement is in the task's evidence.
