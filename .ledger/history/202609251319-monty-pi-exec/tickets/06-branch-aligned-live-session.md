# 06: A live session that follows the session tree, with reset and recovery

**What to build:** Each root Pi session has one live Monty session, so variables and functions persist across `pi_exec` calls. After every call that leaves the Monty session usable (success or an ordinary Python exception), its dump is saved as a Pi session entry. Monty's own dump size limit is the only size bound. When a session starts, reloads, forks, or moves to another point with `/tree`, the live session is rebuilt from the dump nearest to the current branch leaf. A `reset: true` tool parameter starts an empty session. A terminal failure (memory or time limit, worker crash) throws away the live session. The next call restores the last saved dump, and the failed call's result states that the state was rolled back. A dump that cannot be loaded (for example, after a Monty version change) gives an empty session with a notice. The tree and `reset` are the only restore points; there are no named save points. The `state` parameter and snapshot store are removed. The exec documentation, the boundaries entry that rejected persistent kernels, and the execution-context description in the agent guide are updated.

**Blocked by:** 01: Python programs run on Monty with the core tools.

**Status:** done

- [x] `x = 1` in one call, then `x + 1` in the next call, returns 2, and still returns 2 after an extension reload.
- [x] After `/tree` navigation back to a point before `x = 2` was assigned, `x` has its value from that point.
- [x] A call with `reset: true` makes `x` a `NameError`.
- [x] A call that exceeds the memory limit reports the rollback, and the next call still sees the `x` from before the failed call.
- [x] A stored dump that cannot be loaded gives an empty session and a notice, not a failed call.
- [x] The `state` parameter no longer exists on `pi_exec`.
