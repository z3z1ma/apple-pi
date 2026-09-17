# Prompt Stash & External Editor

Prompt stash provides in-memory stashing and external editor integration for Pi's input prompt.

## Features

- **Prompt Stash**: Stash work-in-progress prompts without losing them when switching context.
- **Bounded Capacity**: Stores up to 20 prompts in memory with FIFO eviction when capacity is reached.
- **Interactive Picker**: Browse and restore previous prompts in reverse-chronological order.
- **External Editor**: Compose or edit complex prompts in your preferred external editor (`$VISUAL`, `$EDITOR`, or `vim`).

## Keybindings

| Keybinding | Action |
| --- | --- |
| `Ctrl+S` / `Alt+S` | Stash the current editor prompt (clears editor) |
| `Ctrl+Shift+S` / `Alt+Shift+S` | Pop the most recent prompt from stash into editor |
| `Ctrl+Alt+S` | Open the interactive prompt stash picker |
| `Ctrl+E` / `Alt+E` | Open the current prompt in external editor (`$EDITOR`) |

> Note: Non-Kitty terminals send identical escape sequences for `Ctrl+S` and `Ctrl+Shift+S`. The `Alt+` combinations (`Alt+S`, `Alt+Shift+S`) provide portable cross-terminal support.

## Slash Commands

### `/stash`

Manage stashed prompts through commands:

- `/stash` or `/stash list`: Open the interactive stash picker to choose and pop a prompt.
- `/stash pop`: Pop the top prompt directly into the editor.
- `/stash drop [N]`: Drop the top prompt (or prompt #N, 1-indexed from newest).
- `/stash clear`: Clear all stashed prompts.
- `/stash push [text]`: Push explicit text into the stash without clearing the editor.
- `/stash help`: Display usage summary.

### `/edit-prompt`

Opens the current prompt text in your external editor.

1. Suspends Pi's TUI.
2. Writes prompt text to a temporary markdown file.
3. Spawns `$VISUAL` or `$EDITOR` (falling back to `vim` on macOS/Linux or `notepad` on Windows).
4. Restores Pi's TUI upon exit.
5. If the editor exits cleanly (status 0), updates the editor with the saved text. If the editor is cancelled (non-zero status or `:cq` in vim), preserves the existing prompt text unchanged.
