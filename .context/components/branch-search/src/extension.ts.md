## file

One `search_branches` call runs per root session and blocks until the search ends. The fork prompt is the result of the pending call, so the fork point ends with that call.
Why: aborting the call, a session switch, tree navigation, or shutdown cancels the search. Cleanup waits until worktrees, refs, and the record are final.
