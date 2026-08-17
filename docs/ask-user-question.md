# Ask User Question

The `ask_user_question` tool lets the model group up to four related decisions into one questionnaire. Each question presents two to four described options, always includes a custom free-text answer, and can opt into multi-select. Multiple questions use tabs and a final review step in the terminal.

In the TUI, use `↑`/`↓` to move, `Enter` to select, `Space` or `Enter` to toggle multi-select choices, `Tab`/`←`/`→` to change questions, and `Esc` to cancel. Custom answers use Pi's multiline editor. RPC/ACP hosts receive the same questions through native select/input dialogs; multi-select accepts comma-separated option numbers or free text. The tool removes itself from non-interactive runs so the model falls back to ordinary chat questions instead of calling an unusable UI.
