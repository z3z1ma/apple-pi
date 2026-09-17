# Terse Tools (Antigravity TUI Emulation)

`terse-tools` replaces Pi's default padded, multi-line tool execution cards in the interactive TUI with a compact, single-line representation modeled after Google Antigravity.

## Core Behavior

### Collapsed Single-Line View

By default, every tool execution renders as a single, terse line:

```text
● <ToolName>(<concise arguments>)
```

- **Bullet `●`**: Colored dynamically based on status:
  - Yellow / Warning: Running or in-progress tool execution.
  - Green / Success: Tool execution completed successfully.
  - Red / Error: Tool execution failed.
- **`<ToolName>`**: PascalCase name in bold warm yellow/gold `warning` color (`Bash`, `Read`, `Edit`, `Write`, `Search`, `Find`, `Ls`, `ManageTask`, `Schedule`, `Exec`, `AskUserQuestion`).
- **Arguments**: Concise, single-line string representation (e.g. `Bash(git status --short --branch)`, `Read(~/src/index.ts:10-40)`, `Search(pattern in path)`). File paths shorten `$HOME` to `~`.
- **Contiguous sequence spacing**: Consecutive collapsed tool calls sit directly on adjacent lines without blank separators or padding boxes across multi-turn agent execution loops.
- **Expansion hint**: Only the very last tool call in a contiguous block displays `(ctrl+o to expand)` in muted text.

### Antigravity Thought Cards and Thinking Spinner

Thinking is treated as an active state of the spinner, not an interruption in the transcript:

- **Spinner thought trace**: While the model is actively reasoning, the status spinner at the bottom updates with the current active thought trace (e.g. `⠙ Thinking (Analyzing git status output)`), truncated to fit the terminal.
- **Transcript cleanliness**: The static `"Thinking..."` label is hidden from the transcript entirely. During active reasoning, no partial thoughts or placeholders are printed into the transcript.
- **Thought cards**: When reasoning precedes tool calls or text output, completed thoughts render as a concise Antigravity thought card with a clean line break at the bottom:

```text
▶ Thought for 3s, 1.2k tokens
  Analyzing repository structure...

● Bash(git status)
```

- When text follows thinking, the thought header and snippet also end with a line break before the assistant's text response.
- Intermediate tool calls remain dense with single-line tool rows (`● Tool(...)`), while thought cards and text deltas maintain clean empty-line separation.

### Expanded View (`Ctrl+O`)

Pressing `Ctrl+O` (`app.tools.expand`) toggles full detail:

```text
● Bash(npm test)
  └ Test suite passed
    ... detail lines ... (ctrl+o to collapse)
```

- **Branch indicator**: Detail lines are anchored by `  └ <summary>` followed by 4-space indented detail lines.
- **Diff rendering**: `Edit` tool calls display `  └ +<added> / -<removed> lines` with syntax-highlighted diff lines using theme colors (`toolDiffAdded`, `toolDiffRemoved`, `dim`).
- **Failure rendering**: Errors clearly display the error message on the summary line followed by stderr lines.
- **Collapse hint**: Only the very last line of the last expanded tool displays `(ctrl+o to collapse)` in muted text.
- **Expanded spacing**: Expanded tool calls are separated by a blank line for visual clarity.

## Implementation Details

The extension hooks into Pi at startup via `extensions/terse-tools.ts`:
- Patches `ToolExecutionComponent.prototype.render` to format output via terse formatters.
- Patches `AssistantMessageComponent.prototype.render` and `updateContent` to silence tool-only intermediate turns and render concise thought cards before text.
- Patches `Container.prototype.addChild` to track the parent container, enabling each tool execution component to determine its sibling position across transparent intermediate assistant messages.
- Dynamically captures active theme styling via `Theme.prototype.fg` and falls back cleanly to standard ANSI codes if uninitialized.
