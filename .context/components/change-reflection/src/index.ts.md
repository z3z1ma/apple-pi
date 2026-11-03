## symbol:trackChanges

Records paths changed by successful built-in `edit` and `write` calls, in first-change order, with the tools that ran after each path's last change. The caller clears the map when its reflection window ends.
Why: tool calls inside a forked continuation are not the agent's own changes. Claims in the reflection can only cite checks that ran after the change they describe.

## symbol:runsAfterChanges

Names the checks that ran after each changed path so a reflection claim can be compared with them.
