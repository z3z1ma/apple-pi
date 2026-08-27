# Input card

apple-pi replaces Pi's TUI footer with one composed input card. The card keeps Pi's native editor and its native prompt-text styling, using the available terminal width beneath quiet neutral rules, followed by unlabelled provider/model metadata and a compact information strip. It intentionally has no terminal-glyph box, vertical side rails, artificial width cap, or thinking-level tint across the structure.

The strip presents the project path and Git branch, current context percentage, native `(auto)` automatic-compaction state, token/cache traffic, cost and native `(sub)` subscription state, plus the current `mcp`, MCP-authentication, backlog count, non-completed `todos N` count, Sentinel supervision status (`q-sentinel`), `subagents`, and unknown extension statuses. Active Codex fast mode appears as `⚡` beside the thinking level rather than as a duplicate status segment. The `todos` status disappears when no unfinished to-dos remain; detailed to-do progress belongs in its above-editor widget rather than another footer row. Theme roles distinguish those semantic fields and known producer states without hard-coding a separate palette. Status text is read from Pi's public footer data provider, retains producer-owned ANSI styling, and is not rewritten into a second status model. Detailed agent/FleetView and Pi Exec widgets remain in their existing above/below-editor placements, as does Pi's native working indicator.

The card is responsive: it aligns the identity and telemetry groups when they fit, reflows them into at most two compact strips when needed, and truncates lower-priority detail with an omission marker using ANSI-aware widths. While top-level agents are visible, Fleet navigation guidance shares the model/provider/thinking row on the right instead of adding a dedicated below-editor hint row; narrow layouts preserve model identity and omit the hint when both cannot fit. It does not add a row for every telemetry field.

## Compatibility boundary

The card installs only in TUI mode. RPC and other non-TUI modes keep Pi's normal status and widget protocol; no custom editor or footer is installed there.

Pi 0.84.x does not expose the active session's subscription and automatic-compaction qualifiers through the public footer API. The installer therefore uses the narrowly bounded, synchronous private bridge documented in the input-card task: it captures the active session only while installing its exact empty-footer factory and restores the patched prototype immediately. If the bridge or runtime shape is unsupported, the current editor/footer is left untouched.

Pi permits one custom editor and one custom footer but provides no general editor composition or footer getter/transaction. An already configured custom editor therefore blocks installation. A successful card is the normal last custom-footer owner; if card construction fails after Pi has replaced the footer, the installer restores Pi's built-in editor/footer, while an arbitrary earlier custom footer cannot be recovered.

The card does not intercept terminal input, change autocomplete, paste, submission, keybindings, queueing, shell mode, welcome screens, persistent settings, or working-state semantics. Normal editing continues through `CustomEditor`'s base handler.
