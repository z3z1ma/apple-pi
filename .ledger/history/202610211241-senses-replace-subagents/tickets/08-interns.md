# 08: Interns

**Context:** [spec.md](../spec.md) defines the terms used here (person, operator, runtime, thread, push and pull, ephemeral task, intern) and records the decisions this ticket implements.

**What to build:** `explore` (the local repository and filesystem) and `research` (external sources) are tools for every root session. Each runs one headless Pi process on the one-shot runner `pi_exec` workers use, with the intern's fixed prompt, read-only tools, and the `quick` profile, streams its current tool and argument as a live activity line, returns the final text, and exits. Esc kills the process. The descriptions frame them as a cheap intern: fast, cheap, keeps reading out of your context; a lossy summary of only what it chose to report; it can miss, misread, or state a belief as fact, so verify before acting and read the source when the detail decides. Startup latency is measured once and recorded as evidence.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] With a fake worker `pi`, `explore` returns the worker's final text, reports its tool calls as activity, and leaves no process behind.
- [x] Aborting the tool call kills the worker process.
- [x] Two intern calls in one assistant message run at the same time.
- [x] Each tool's description and guidelines carry the intern framing, and the word "sense" appears in no prompt, tool, or doc.
- [x] One startup-latency measurement is in the task's evidence.

## Implementation and checks

`components/interns/` owns two parallel tools with fixed prompts and the `quick` profile. Both reuse the existing one-shot runner, return prose, show live tool/argument activity, and release their process and bound material. SIGTERM preserves Pi's cleanup of detached tool processes. The runtime and workers share the main-argument selector.

[Evidence](../evidence/08-interns.md): 130 focused tests passed across the final runs, plus typecheck, loader, package dry run, formatting, lint (one existing notch-test warning), and context lint. A real Pi process reached a local fixture model in 1,899 ms and returned/exited in 1,918 ms. No live runtime or session was restarted.

**Deviations:** None. The old generic surface remains until ticket 11; its two reading types share the intern prompts during the transition.
