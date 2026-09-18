# Input editor

apple-pi replaces Pi's TUI footer and editor with a composed input editor. It keeps Pi's native editor and prompt-text styling inside an Opencode-style frame with a left accent rail (`│ `) styled in the theme accent color, or `bashMode` while entering a shell command.

The bottom row of the editor displays:
- **Left**: Model identity, provider name, and thinking level, with active vroom mode displayed as `⚡` beside the thinking level.
- **Right**: A muted, right-aligned status indicator showing only active items:
  - `ctx X%`: current context percentage (always shown when context usage is available).
  - `pair`: shown only while the pair programmer is actively reviewing (`pair · ctx X%`).
  - `mcp:N`: shown when MCP servers are configured (`mcp:N · ctx X%` or `pair · mcp:N · ctx X%`).

No bottom rail `─────────` or separate status footer is rendered below the editor; the editor component is the last visible element and touches the bottom of the terminal.

At narrow terminal widths, optional items (`pair`, `mcp:N`) are dropped before `ctx X%`. All right-aligned status text is rendered in muted theme color.

## Compatibility boundary

The input editor installs only in TUI mode. RPC and other non-TUI modes keep Pi's normal UI protocol.

Pi's built-in footer is replaced with a zero-line footer component, passing extension status data to the editor. Editing, autocomplete, paste, submission, keybindings, queueing, shell mode, welcome screens, persistent settings, and working-state semantics continue through `CustomEditor`'s base handler.
