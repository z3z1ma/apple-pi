## file

Worktree fixtures live inside the parent's Git directory, as branch search does. One symlink fixture makes `pivot` lead into the parent workspace and applies `..` after following it. Another runs the parent from a repository subdirectory.
Why: lexical path normalization or remapping every parent-root path would hide isolation failures in these layouts.
