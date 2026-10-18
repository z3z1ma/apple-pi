# 03: Rich activity

**What to build:** Each session's full activity is captured: the current tool with its main argument and start time, an open prompt with kind and title (and a questionnaire's questions), queued steers and follow-ups, the last error and abort, model, thinking level, context use and cost, configuration (name, flags, active tools, extensions, skills, MCP servers), and compaction. Every change is an event; streaming text and tool progress only refresh current state.

**Blocked by:** 01 Runtime and bridge tracer

**Status:** ready-for-agent

- [ ] While a faux session runs a tool, the database shows the tool's name, main argument, and start time; after it ends, a tool start and a tool end event exist with duration.
- [ ] While `ask_user_question` is open, the session shows an open prompt of kind questionnaire with the actual questions and options; closing it clears the prompt and records an event.
- [ ] Queued steers and follow-ups appear in the session's queue and leave it when delivered.
- [ ] An aborted run records the abort, and a failed provider response records the last error.
- [ ] Model, thinking level, context tokens and window, cost, session name, flags, active tools, extensions, skills, and MCP servers are present for the session and update with events when they change.
- [ ] A long streaming reply and a tool with progress updates produce no per-delta or per-update event rows.
