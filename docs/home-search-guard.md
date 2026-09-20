# Search root guard

The search root guard blocks agent searches from collection roots that are too broad to scan safely. It forces the agent to choose a specific repository, worktree, or subdirectory before searching.

The invariant filesystem root `/` and the legacy default `$HOME` are always protected. Additional roots come from `searchRootGuard.protectedRoots` in global `~/.pi/agent/settings.json`. A trusted project's `.pi/settings.json` may add roots but cannot remove global or baseline protections:

```json
{
  "searchRootGuard": {
    "protectedRoots": [
      "~/code_projects",
      "~/code_projects/work"
    ]
  }
}
```

Configured roots must be absolute paths or supported `~`, `$HOME`, or `${HOME}` paths. Relative paths, globs, other variables, substitutions, empty entries, and malformed schemas fail closed with a visible configuration error.

The guard covers:

- Pi `grep`, `find`, and `glob` tool calls when their explicit or implicit root resolves to a protected root;
- agent `bash` calls that use `rg`, `ripgrep`, `grep`, `egrep`, `fgrep`, `find`, `fd`, or `fdfind` with a protected literal search root the guard can resolve;
- path aliases that resolve through an existing symlink to a protected root;
- the same tools in the root session, interactive child agents, and `pi_exec` workers;
- direct `pi.grep`, `pi.find`, and `pi.bash` calls inside `pi_exec`.

A path below a protected root remains valid. For example, Pi `grep` or shell `rg` may search `$HOME/code_projects/work/repos/service`; searching `$HOME/code_projects/work` is blocked.

For recognized shell search commands, the extension uses a bounded grammar for direct invocations and simple literal `cd` chains. It blocks only when it can resolve an actual traversal root to a protected root; ambiguous shell syntax, wrappers, variables, substitutions, and unknown indirection fail open rather than risking a false positive. Patterns are not treated as roots, so commands such as `rg '/' .` remain valid. For `find`, only leading starting points are roots; expression operands such as `-path PATTERN` are inert predicates even when they resemble protected paths.

This is best-effort shell inspection, not an operating-system sandbox for arbitrary programs launched through `bash`. Read-only explorer agents do not receive `bash`, so all of their filesystem searches pass through the guarded Pi tools.

The extension intercepts agent tool calls only. It does not intercept shell commands entered directly by the user with Pi's `!` or `!!` syntax.
