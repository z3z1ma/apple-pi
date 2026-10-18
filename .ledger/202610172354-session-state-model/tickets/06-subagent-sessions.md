# 06: Subagent sessions

**What to build:** Interactive child sessions (subagents) load the bridge like other child extensions, connect on their own, and appear in the model linked to their parent session, with the parent's process as their incarnation and the same activity facts as root sessions.

**Blocked by:** 01 Runtime and bridge tracer; 03 Rich activity

**Status:** done

- [x] When a faux root session starts a subagent, the database shows a child session linked to the parent session, with the parent's pid as its incarnation's process.
- [x] The child's run state, current tool, and usage update while it works, with events.
- [x] Stopping the subagent ends the child's incarnation; ending the parent ends both.
- [x] `pi_exec` workers and forked continuations do not appear as sessions.
