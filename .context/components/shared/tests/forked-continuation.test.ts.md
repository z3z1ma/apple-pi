## file

Provider-history fixtures observe the session id at the stream boundary, with one history slot per id. Cover concurrent ordinary and worktree forks, multiple requests within each fork, parent resumption, and an absent parent provider id. The parent Pi session id remains unchanged for tool-hook scoping.
Why: checking only the parent's in-memory messages misses a provider-side history collision; copying the parent's provider id leaves those messages intact while overwriting the provider's history slot.

Worktree fixtures live inside the parent's Git directory, as branch search does. One symlink fixture makes `pivot` lead into the parent workspace and applies `..` after following it. Another runs the parent from a repository subdirectory.
Why: lexical path normalization or remapping every parent-root path would hide isolation failures in these layouts.
