# Notify

Native macOS completion notifications for Pi, with Ghostty/tmux click-to-focus.

The extension is registered from `extensions/notify.ts` over `components/notify/`. It is macOS-only: the `agent_settled` delivery path is gated to `darwin`, and `/notify-setup` refuses to run elsewhere.

## Behavior

- Notifies on `agent_settled`, after retries, compaction retries, and queued follow-ups finish. Delivery is detached from the settlement hook so focus checks and notifier timeouts cannot delay the next turn. One notification per Pi session (keyed by session and leaf), not per concurrent session.
- Also notifies when the `ask_user_question` tool starts, since that tool blocks the turn waiting on the operator and `agent_settled` does not fire while it is pending. The body shows the first question (with a `(+N more)` suffix for multi-question prompts). Delivery is fire-and-forget so notifier timeouts never delay the questionnaire dialog.
- Automatic notifications (both the settle and ask paths) are suppressed when the operator is already viewing the pane — Ghostty is the frontmost app and the foreground (most-recently-active) tmux client is currently displaying the window that contains the pane. Comparing against the foreground client's window, rather than a per-session active-window flag, avoids falsely suppressing when a background Ghostty tab is attached to the Pi session. Detection lives in `scripts/focus-check.sh` and fails open: any inconclusive result still delivers. `/notify-test` is exempt and always delivers.
- Suppression is best-effort, not guaranteed. tmux cannot report which Ghostty tab is frontmost, so the foreground client is approximated by the most-recently-active tmux client. Fail-open covers inconclusive detection, but a wrong foreground-client guess can still mis-fire: if the operator types in the Pi pane and then switches Ghostty tabs without typing again, the Pi client can keep the highest activity and a notification may be suppressed even though the operator has looked away. The trade-off favors quiet over certainty on the automatic paths; use `/notify-test` (never suppressed) to verify delivery.
- Title shows tmux coordinates plus the Pi session or project name; the subtitle is the latest user prompt; the body is the final outcome.
- Terminal provider errors and cancelled tasks are reported explicitly — including `cyber_policy` blocks — instead of being shown as successful completion.
- Plays the macOS `Glass` sound by default.
- Clicking the notification activates Ghostty and selects the original tmux pane.
- Logs delivery metadata only (timestamp, delivery method, session ID, tmux coordinates) — never prompt or answer contents.

## Requirements

- macOS.
- [`terminal-notifier`](https://github.com/julienXX/terminal-notifier): `brew install terminal-notifier`.

Ghostty and tmux are optional; notifications still work without them, but click-to-focus requires both.

## Commands

| Command | Description |
| --- | --- |
| `/notify-setup` | Install or refresh the dedicated macOS `Pi Notifier.app` sender (created at `~/Applications/Pi Notifier.app`) so notifications appear under a Pi identity and icon in Notification settings. |
| `/notify-test` | Send a test notification and verify tmux click-to-focus. |

The package works immediately through Homebrew's `terminal-notifier` and its bundled Pi icon; the dedicated sender app is optional. macOS may ask for notification permission the first time it delivers.

## Configuration

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `PI_NOTIFY_DISABLED=1` | Disable notifications. |
| `PI_NOTIFY_SOUND=name` | Change the macOS sound; defaults to `Glass`. |
| `PI_NOTIFY_APP=/path/app` | Override the notifier app path. |
| `PI_NOTIFY_FOCUS_SCRIPT=/path/script` | Override the tmux focus script. |
| `PI_NOTIFY_LOG_PATH=/path/log` | Override the metadata log path (default `~/.pi/agent/logs/pi-notify.log`). |
| `PI_NOTIFY_DISABLE_LOG=1` | Disable metadata logging. |
| `TMUX_BIN=/path/tmux` | Override the tmux binary the focus script uses. |
| `TMUX_SOCKET=/path/socket` | Override the tmux server socket the focus script targets. |

## Click-to-focus internals

Clicking a notification runs `scripts/focus-tmux.sh` via terminal-notifier's `-execute`. That command runs in a minimal launchd context with **no `$TMUX` and no interactive `$PATH`**, so the extension resolves the absolute tmux binary (via a PATH lookup, so the client matches the running server's protocol version) and the server socket at notification time and bakes both into the stored command as `TMUX_BIN=` and `TMUX_SOCKET=`. The script honors those, augments `PATH` with common install locations (Homebrew, nix-darwin, `~/.nix-profile`), resolves an explicit tmux client for `switch-client -c`, then runs `select-window` and `select-pane` on the global `@window`/`%pane` ids.

When click-to-focus misbehaves, the focus log at `~/.pi/agent/logs/pi-focus-tmux.log` records the resolved `tmux_bin`, `socket`, and the result of each tmux step. `abort no tmux executable` means no usable tmux was found in the click context; a `switch-client ... failed` line means no client could be resolved for the target session.

## Fallback order

```text
Pi Notifier.app
→ Homebrew terminal-notifier
→ Ghostty AppleScript
→ macOS AppleScript
```

The AppleScript fallbacks can display notifications but cannot guarantee exact tmux pane selection when clicked.
