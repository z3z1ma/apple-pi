## file

The scratch tmux server uses its own `TMUX_TMPDIR` and a real client, so the pane a client shows is what tmux reports. Without a UI from the start, `ask_user_question` leaves the active tools. A rebound bridge must reconnect before a settle, or the runtime does not see it. A session left open would start a new runtime after the test stops this one.
Why: the question tool drops itself at `before_agent_start` without a UI, and a settle before reconnect is invisible.
Verify: components/session-state/tests/attention.test.ts
