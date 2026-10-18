## symbol:Dashboard.show_preview

Showing an unseen agent's live view for `SEEN_AFTER_SECONDS` marks it seen only while a tmux client shows the dashboard's window and the app has terminal focus. While no client shows the window, the dashboard also stops capturing panes and animating spinners.
Why: reading a finished agent's final output in the live view is looking at it; requiring `x` as well left read agents in NEEDS YOU. Terminal focus alone is not enough: a dashboard in a window no client shows (detached, or created by a script) never receives a focus-out, so it would clear agents nobody read.
Verify: components/tmux-sessions/sidebar/tests/test_dashboard.py

## symbol:Dashboard.send

A reply is sent as a `talk` command only when the session is idle, re-read from the database at send time.
Why: the status can change while you type; the runtime would refuse `talk` to a busy session, but the dashboard says so up front instead of sending a command that fails.

## symbol:Dashboard.highlighted

A `RowHighlighted` message whose row is no longer the cursor row is ignored.
Why: rebuilding the rows highlights row 0 before the cursor moves back to the selected agent, and acting on it flickers the live view to another agent.
