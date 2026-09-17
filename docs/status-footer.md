# Input card

apple-pi replaces Pi's TUI footer with one composed input card aligned with upstream `pi-zentui`. The card keeps Pi's native editor and prompt-text styling inside an Opencode-style frame: a left accent rail (`│ `) styled in theme accent (or `bashMode` when executing shell commands), quiet neutral horizontal rules (`─`) at the top and bottom with viewport scroll indicators, and internal breathing lines separating the prompt input from the unlabelled provider/model metadata line.

Directly below the frame sits a Starship-inspired information footer:
- **Left side**: project working directory, session name (`in <name>`), git branch (`on ⑂ <branch>`), and all Apple Pi extension statuses (`mcp-auth`, `mcp` servers, `backlog`, `todos`, pair programmer supervision status `q-pair`, and `subagents`).
- **Right side**: muted telemetry elements separated by pipe delimiters (` | `), including context percentage/window with native `(auto)` compaction state, token/cache traffic, and session cost with native `(sub)` subscription state.
- **Inside the frame**: model identity, provider name, and thinking level with active vroom (fast mode) displayed as `⚡` beside the thinking level. Fleet navigation guidance (`subagents-navigation`) is right-aligned on the metadata line when space permits.

The card is responsive: it aligns the identity and telemetry groups when they fit, reflows them into at most two compact strips when needed, and truncates lower-priority detail with an omission marker using ANSI-aware widths. Detailed agent/FleetView and Pi Exec widgets remain in their existing above/below-editor placements, as does Pi's native working indicator.

## Compatibility boundary

The card installs only in TUI mode. RPC and other non-TUI modes keep Pi's normal status and widget protocol; no custom editor or footer is installed there.

Pi 0.84.x does not expose the active session's subscription and automatic-compaction qualifiers through the public footer API. The installer therefore uses the narrowly bounded, synchronous private bridge documented in the input-card task: it captures the active session only while installing its exact empty-footer factory and restores the patched prototype immediately. If the bridge or runtime shape is unsupported, the current editor/footer is left untouched.

Pi permits one custom editor and one custom footer but provides no general editor composition or footer getter/transaction. An already configured custom editor therefore blocks installation. A successful card is the normal last custom-footer owner; if card construction fails after Pi has replaced the footer, the installer restores Pi's built-in editor/footer, while an arbitrary earlier custom footer cannot be recovered.

The card does not intercept terminal input, change autocomplete, paste, submission, keybindings, queueing, shell mode, welcome screens, persistent settings, or working-state semantics. Normal editing continues through `CustomEditor`'s base handler.
