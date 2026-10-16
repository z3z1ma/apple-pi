## symbol:Dashboard.show_preview

Showing an unseen agent's live view for `SEEN_AFTER_SECONDS` while the dashboard has terminal focus marks it seen.
Why: reading a finished agent's final output in the live view is looking at it; requiring `x` as well left read agents in NEEDS YOU. The focus check keeps a dashboard left open in a background window from clearing agents nobody read.
Verify: components/tmux-sessions/sidebar/tests/test_dashboard.py

## symbol:Dashboard.send

A reply is typed into the agent's pane only when the agent is idle, re-read from tmux at send time.
Why: `send-keys` into a busy agent or an open questionnaire would land in the wrong prompt; the status can change while you type.

## symbol:Dashboard.highlighted

A `RowHighlighted` message whose row is no longer the cursor row is ignored.
Why: rebuilding the rows highlights row 0 before the cursor moves back to the selected agent, and acting on it flickers the live view to another agent.
