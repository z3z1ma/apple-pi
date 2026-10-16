## symbol:Dashboard.show_preview

Showing an unseen agent's live view for `SEEN_AFTER_SECONDS` marks it seen only while a tmux client shows the dashboard's window and the app has terminal focus. While no client shows the window, the dashboard also stops capturing panes and animating spinners.
Why: reading a finished agent's final output in the live view is looking at it; requiring `x` as well left read agents in NEEDS YOU. Terminal focus alone is not enough: a dashboard in a window no client shows (detached, or created by a script) never receives a focus-out, so it would clear agents nobody read.
Verify: components/tmux-sessions/sidebar/tests/test_dashboard.py

## symbol:Dashboard.send

A reply is typed into the agent's pane only when the agent is idle, re-read from tmux at send time.
Why: `send-keys` into a busy agent or an open questionnaire would land in the wrong prompt; the status can change while you type.

## symbol:Dashboard.highlighted

A `RowHighlighted` message whose row is no longer the cursor row is ignored.
Why: rebuilding the rows highlights row 0 before the cursor moves back to the selected agent, and acting on it flickers the live view to another agent.
