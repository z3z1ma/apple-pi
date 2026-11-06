## file

`session_evidence` lists what this repository's sessions recorded since a window start: notebook learnings (each note id once, at its first record), refusals (an error tool result whose text starts with "Refused", from repository rules and harness guards), failed tool calls other than `bash` (a shell command exiting nonzero is ordinary work, not a harness failure), and calls of saved programs: a direct tool call, or an executed call recorded in a tool result's `details.calls` (codemode and saved programs record every call their script made), never a name merely written in a script. Items carry their session file, sorted by instant. It reads the session JSONL through `session-logs.ts`, never the runtime, and groups nothing: the capability steward groups recurring items itself.
Why: similarity between differently worded lessons is a judgment a model makes better than a token measure, and a raw, linked list keeps the evidence checkable. Streaming the logs took 2 seconds for 15 sessions and 440 items since 2026-11-01 on this machine, so the transcript index was not needed.

The same window rule as `replay_rule` applies: `since` is explicit and stated.
Coupled: components/repo-rules/src/replay.ts, components/shared/src/session-logs.ts, components/system-prompt/src/toolbox.ts, roles/capability-steward.md
Verify: components/repo-rules/tests/evidence.test.ts
