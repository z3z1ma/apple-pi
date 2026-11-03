## file

Search Git plumbing never writes the user's index. Snapshot trees use a temporary index and include uncommitted and untracked non-ignored files. Parsed or applied diffs disable external diff and textconv drivers.
Why: configured drivers can replace real content changes. Protected paths must stay within the worktree after resolving symlinks, including replaced ancestors. Restoring a link alone would leave its target unprotected. Validate all targets before removing or cloning anything.

Protected paths are restored to base before scoring, including removal of added and ignored files. Overlapping cloned ignored directories come from a pre-attempt snapshot. Protected-state comparison includes HEAD, tracked content and untracked files, but excludes ignored caches that scoring legitimately writes. An unfinished directory comparison counts as a difference. Cleanup attempts every locked or dirty worktree, prunes records and reports anything left.
Why: scoring must inspect the restored attempt, not an attempt-weakened gate. Cloned dependency directories remain excluded from cleaning even with `-x`.

Apply requires the workspace to retain the base tree. The binary patch survives cleanup and lands only in the working tree. Cancellation is checked last before writing; an unchanged winner skips the empty patch. A failed apply rolls back only paths still holding exactly the winner's content or deletion. Paths changed by someone else or already at base stay untouched. Only absence counts as absent; inspection failure cannot prove ownership. Rollback uses a temporary index, never the user's index. Binary numstat rows count as zero lines.
Why: `git apply` checks first but cannot undo a partial write. Conditional rollback preserves concurrent work.
