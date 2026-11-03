## file

Temporary-directory cleanup is best effort and runs before restarting and redrawing the TUI.
Why: cleanup failure must not prevent return to the terminal interface.
