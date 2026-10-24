# Terse Tools (Antigravity TUI Emulation)

`terse-tools` replaces Pi's default padded, multi-line tool execution cards in the interactive TUI with a compact, single-line representation modeled after Google Antigravity.

## Core Behavior

### Collapsed Single-Line View

By default, every tool execution renders as a single, terse line:

```text
● <ToolName>(<concise arguments>)
```

- **Bullet `●` / `▲`**: Colored dynamically based on status:
  - Standard circle `●`: Regular tool execution.
  - Upward triangle `▲`: Command output was compressed by RTK (Rust Token Killer).
  - Yellow / Warning: Running or in-progress tool execution.
  - Green / Success: Tool execution completed successfully.
  - Red / Error: Tool execution failed.
- **`<ToolName>`**: PascalCase name in bold warm yellow/gold `warning` color (`Bash`, `Read`, `Edit`, `Write`, `Search`, `Find`, `Ls`, `ManageTask`, `RemindMe`, `Monitor`, `Exec`, `AskUserQuestion`).
- **Arguments**: Concise, single-line string representation (e.g. `Bash(git status --short --branch)`, `Read(~/src/index.ts:10-40)`, `Search(pattern in path)`). File paths shorten `$HOME` to `~`.
- **Contiguous sequence spacing**: Consecutive collapsed tool calls sit directly on adjacent lines without blank separators or padding boxes across multi-turn agent execution loops.
- **Expansion hint**: Only the very last tool call in a contiguous block displays `(ctrl+o to expand)` in muted text.
- **Mail and pair notes join the stream**: delivered [mail](organization.md) renders as one line in the theme's link color, `✉ Mail(<sender> · <subject>: <start of the body>...)`, truncated to the terminal width; it shows the whole body when thinking blocks are visible (`Ctrl+T` by default), independently of tool expansion. Existing mail follows that setting immediately, including restored history. Pair notes render as one bullet line each. Neither adds the blank lines Pi puts around other custom messages (`components/shared/src/compact-custom-message.ts`).

### Antigravity Thought Cards and Thinking Spinner

Thinking is treated as an active state of the spinner, not an interruption in the transcript:

- **Spinner thought trace**: While the model is actively reasoning, the status spinner at the bottom updates with the current active thought trace (e.g. `⠙ Thinking (Analyzing git status output)`), truncated to fit the terminal.
- **Transcript cleanliness**: The static `"Thinking..."` label is hidden from the transcript entirely. During active reasoning, no partial thoughts or placeholders are printed into the transcript.
- **Thought cards**: When `Thinking blocks` is visible and reasoning precedes tool calls or text output, completed thoughts render as a concise Antigravity thought card with a clean line break at the bottom:

```text
▶ Thought for 3s, 1.2k tokens
  Analyzing repository structure...

● Bash(git status)
```

- When `Thinking blocks` is hidden, completed reasoning renders no transcript rows. Surrounding tool calls remain a single unbroken sequence; assistant text and stop errors remain visible.
- When text follows visible thinking, the thought header and snippet also end with a line break before the assistant's text response.
- Intermediate tool calls remain dense with single-line tool rows (`● Tool(...)`), while visible thought cards and text deltas maintain clean empty-line separation.

### Expanded View (`Ctrl+O`)

Pressing `Ctrl+O` (`app.tools.expand`) toggles inline previews for all tool calls:

```text
● Bash(npm test)
  └ Test suite passed
    ... detail lines ... (ctrl+o to collapse)
```

- **Branch indicator**: Detail lines are anchored by `  └ <summary>` followed by 4-space indented detail lines.
- **Source rendering**: expanded `Read` output and `Write` content use Pi's extension-based, theme-aware syntax highlighting. Write content is also visible while the call is running. Unknown file types use the normal output color; errors default to the error color.
- **Diff rendering**: `Edit` diffs keep Pi's line numbers and word-level comparison, including Pi's preview while the call is running. Changed words use bold text rather than reverse-video background blocks, preserving the red/green line colors and the terminal background. `Edit` tool calls display `  └ +<added> / -<removed> lines` with syntax-highlighted diff lines using theme colors (`toolDiffAdded`, `toolDiffRemoved`, `dim`).
- **Failure rendering**: Errors clearly display the error message on the summary line followed by stderr lines.
- **Command colors**: emitted ANSI colors and text styles survive in the transcript and inspector, including styles that span multiple output lines. Each output line resets styling before the UI adds its hints or borders. Commands still run with piped output, so programs that disable automatic colors may need their own option, such as `--color=always`; Apple Pi leaves that choice to the command.
- **Warnings**: output truncation, search/list limits, and retained full-output paths remain visible in the warning color, even when the compact preview omits the output tail.
- **Collapse hint**: The last expanded tool displays `(ctrl+o to collapse)` in muted text; output warnings follow its preview.
- **Expanded spacing**: Expanded tool calls are separated by a blank line for visual clarity.

User messages keep Pi's Markdown theme, fenced-code syntax colors, and Markdown transforms inside the accent-rail layout. Assistant Markdown and native image rendering remain with Pi.

## Tool Inspector and Mouse Interaction

Use the inspector to read one tool call's inputs and retained output without expanding the rest of the transcript. Restart Pi after updating the package to load the renderer patch.

In fullscreen mode, left-click the gold tool name to open a read-only inspector. Clicking anywhere else in that tool's header row expands or collapses only that call. Clicking expanded output also collapses that call. Blank separator rows do not toggle calls, and dragging remains available for transcript text selection. `Ctrl+O` still controls global tool expansion.

The inspector has **Inputs** and **Output** tabs. Inputs show every argument. Read output, Write content, and Edit source arguments use the same syntax colors as Pi's native renderer; `pi_exec`'s `code` argument uses Python syntax colors, structured arguments and details use JSON highlighting, and edit diffs emphasize changed words in bold without background highlighting. Top-level multiline strings, such as commands and prompts, display as readable text; Edit batches show each replacement as readable source; other nested objects and arrays display as formatted JSON. Output shows all retained text blocks and structured result details, including edit diffs, without the transcript preview's line limit. Image results are identified but are not rendered inside the inspector. Running calls update while the inspector is open.

Use Tab or Shift+Tab to switch tabs, the mouse wheel or arrow keys to scroll, Page Up/Page Down to page, and Home/End to jump. Esc or `q` closes the inspector and returns to the transcript.

In fullscreen mode, a left click outside the inspector also closes it. The same behavior applies to other focused modal overlays: an outside click follows their Escape/cancel path and does not activate anything behind them. Clicks inside, scrolling, and dragging keep their normal behavior. Non-modal panels such as `/work` stay open.

Run `/inspect-tool` to select a call from the current branch, newest first. This is also the keyboard entry point in regular terminal mode, where Pi leaves transcript mouse interaction to the terminal.

The inspector displays retained results; it does not rerun tools, recover RTK-compressed content, or load full-output files automatically. A truncated result retains its truncation notice and any recorded full-output path. Background commands show their launch result; inspect their later output through `/tasks`. `Exec` shows its arguments and returned result, not unreturned intermediate operations.

## Implementation Details

The extension hooks into Pi at startup via `extensions/terse-tools.ts`:
- Patches `ToolExecutionComponent.prototype.render` to format output via terse formatters and records the displayed header, label, and output bounds for matching mouse dispatch.
- Patches `ToolExecutionComponent.prototype.handleMouse` to open the inspector from the label and toggle the selected call elsewhere in its header or output.
- Patches fullscreen overlay mouse dispatch to route outside left-button presses through the focused modal's Escape handler, using Pi's rendered overlay bounds and consuming the rest of the mouse gesture.
- Opens the inspector through Pi's custom overlay API and releases it on session shutdown or tree navigation; `/inspect-tool` derives its selection from the active session branch without a separate transcript store.
- Patches `AssistantMessageComponent.prototype.render` and `updateContent` to silence tool-only intermediate turns and render concise thought cards before text.
- Patches `Container.prototype.addChild` to track the parent container, enabling each tool execution component to determine its sibling position across transparent intermediate assistant messages.
- Dynamically captures active theme styling via `Theme.prototype.fg` and falls back cleanly to standard ANSI codes if uninitialized.
