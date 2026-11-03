## symbol:rewriteCommand

Returns the rewritten command, or null when RTK is unavailable or leaves the command unchanged.
Why: rewrite failures stay fail-open. An unexpected error must not block the original command or escape the caller.
