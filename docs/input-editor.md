# Input editor

apple-pi replaces Pi's TUI footer and editor with a composed input editor. It keeps Pi's native editor and prompt-text styling inside an Opencode-style frame with a left accent rail (`│ `) styled in the theme accent color, or `bashMode` while entering a shell command.

The bottom row of the editor displays:
- **Left**: Model identity, provider name, and thinking level, with active vroom mode displayed as `⚡` beside the thinking level.
- **Right**: A muted, right-aligned status indicator showing only active items:
  - `ctx:X%`: current context percentage, rounded to a whole number (always shown when context usage is available).
  - `hit:X%`: the overall session's prompt-cache hit rate, rounded to a whole number and shown after cache activity is reported.
  - `pair`: shown only while the pair programmer is actively reviewing.
  - `mcp:N`: shown when MCP servers are configured.
  - `agents:N`: shown for running and queued public top-level subagents.
  - `tasks:N`: shown for scheduled, due, and running managed tasks.

A typical status is `mcp:N · hit:X% · agents:N · tasks:N · ctx:X%`; active pair review prefixes it with `pair ·`. Cache hit rate is the session-wide cached prompt tokens divided by all session prompt tokens (uncached input, cache reads, and cache writes), including compaction and branch-summary model calls. It is initialized once from session history, then updated as new usage completes.

No bottom rail `─────────` or separate status footer is rendered below the editor; the editor component is the last visible element and touches the bottom of the terminal.

At narrow terminal widths, optional items are dropped from left to right (`pair`, `mcp:N`, then `hit:X%`, `agents:N`, and `tasks:N`) before `ctx:X%`. All right-aligned status text is rendered in muted theme color.

## Compatibility boundary

The input editor installs only in TUI mode. RPC and other non-TUI modes keep Pi's normal UI protocol.

Pi's built-in footer is replaced with a zero-line footer component, passing extension status data to the editor. Editing, autocomplete, paste, submission, keybindings, queueing, shell mode, welcome screens, persistent settings, and working-state semantics continue through `CustomEditor`'s base handler.
