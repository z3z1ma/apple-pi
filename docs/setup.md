# Setup from scratch

This guide takes a new macOS machine to a working apple-pi environment: Ghostty, tmux, Node.js, Pi, apple-pi, model profiles, and the optional helpers. Linux works for the core package, but notifications and click-to-focus are macOS-only.

## 1. Install the base tools

Install [Homebrew](https://brew.sh) if it is missing:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then install the terminal, multiplexer, runtime, and helpers:

```bash
brew install --cask ghostty
brew install tmux fzf jq git node terminal-notifier rtk
```

| Tool | Why |
| --- | --- |
| `ghostty` | Terminal. Notification clicks focus Ghostty and the exact tmux pane. |
| `tmux` (≥ 3.2) | Session popups and the session picker. |
| `fzf`, `jq` | Required by the tmux session picker. |
| `node` (≥ 22.19.0) | Runtime for Pi and apple-pi. |
| `terminal-notifier` | Native macOS notifications. |
| `rtk` (≥ 0.23.0) | Optional. Compresses bash output to save tokens. Apple-pi skips it when absent. |

Check the versions:

```bash
node --version   # v22.19.0 or later
tmux -V          # 3.2 or later
```

Open Ghostty and use it for every remaining step.

## 2. Install Pi

```bash
npm install -g @earendil-works/pi-coding-agent
pi --version     # 0.99.0 or later
```

Start `pi` once and run `/login` to connect each provider you will use (subscription or API key). Then quit with `Ctrl+C` twice or `/quit`.

## 3. Install apple-pi

Choose one path.

| | Cloned checkout | Pi git package |
| --- | --- | --- |
| Command | `git clone` + `pi install /path` | `pi install git:github.com/z3z1ma/apple-pi` |
| Edit code | Yes. Edits apply after `/reload`. | No. Pi owns the clone; local edits are overwritten. |
| Updates | `git pull && npm install` | `pi update --extensions` |
| Run tests, contribute | Yes | No |
| Best for | Hacking on the harness | Using the harness as is |

### Option A: cloned checkout (hackable)

```bash
mkdir -p ~/code && cd ~/code
git clone https://github.com/z3z1ma/apple-pi.git
cd apple-pi
npm install
pi install "$PWD"
```

Pi loads the package from this directory without a copy. Record the location for the next steps:

```bash
export APPLE_PI=~/code/apple-pi
```

### Option B: Pi git package (low maintenance)

```bash
pi install git:github.com/z3z1ma/apple-pi
```

Pi clones the package and installs its dependencies. Record the location for the next steps:

```bash
export APPLE_PI=~/.pi/agent/git/github.com/z3z1ma/apple-pi
```

Add `-l` to either `pi install` command to activate apple-pi only for the current project instead of globally. Confirm the install with `pi list`.

## 4. Configure model profiles

Apple-pi will not start its pair programmer or teammates without `~/.pi/agent/model-profiles.json`. Copy the example that matches your provider:

```bash
mkdir -p ~/.pi/agent

# Anthropic
cp "$APPLE_PI/model-profiles.anthropic.json" ~/.pi/agent/model-profiles.json

# or OpenAI
cp "$APPLE_PI/model-profiles.openai.json" ~/.pi/agent/model-profiles.json
```

Each entry must name a `provider/model` that Pi knows and that you have logged in to. Check the names with `pi --list-models` and edit the file if your account exposes different models. The seven profile names are fixed; see [Model profiles](model-profiles.md) for the rules. Profiles can mix providers.

## 5. Configure tmux

Create `~/.tmux.conf` (or add to it), replacing `~/code/apple-pi` with your `APPLE_PI` path (`echo $APPLE_PI`):

```tmux
set -g mouse on
set -g default-terminal "tmux-256color"
set -as terminal-features ",xterm-ghostty:RGB"
set -g focus-events on
set -g extended-keys on
set -g extended-keys-format csi-u

run-shell ~/code/apple-pi/components/tmux-sessions/pi_session_manager.tmux
```

Extended keys let Pi tell `Shift+Enter`, `Ctrl+Shift+S`, and similar keys apart inside tmux. On tmux 3.2–3.4, remove the `extended-keys-format` line. See Pi's tmux guide for details. Extended-key settings apply only to a new tmux server, so restart it:

```bash
tmux kill-server 2>/dev/null; tmux new -s main
```

The default prefix is `Ctrl+B`. Then:

- `prefix` + `y` opens or reattaches a Pi session for the current directory in a popup.
- `prefix` + `u` opens the fuzzy session picker.

See [Tmux sessions](tmux-sessions.md) for options.

## 6. Set up notifications (macOS)

Inside Pi:

```text
/notify-setup
/notify-test
```

`/notify-setup` creates `~/Applications/Pi Notifier.app` so notifications show a Pi identity. Allow notifications when macOS asks. Clicking a notification focuses Ghostty and the original tmux pane. See [Notifications](notify.md).

## 7. Optional configuration

- **MCP servers:** add them to `~/.pi/agent/mcp.json` with `"exposure": "deferred"`, add `"extensions": ["-builtin:codemode"]` to `~/.pi/agent/settings.json` so `pi_exec` is the only composition runtime, then run `/reload` and `/mcp`. See [MCP](mcp.md).
- **Editor:** set `EDITOR` in your shell profile (for example `export EDITOR=nvim`) for `Ctrl+E` prompt editing.
- **RTK:** set `RTK_DISABLED=1` to turn RTK off. See [RTK](rtk.md).
- **Branch search:** the main agent's `search_branches` tool stays off until a configuration exists. Copy the example, then run `/reload`:

  ```bash
  cp "$APPLE_PI/branch-search.example.json" ~/.pi/agent/branch-search.json
  ```

  The example runs 3 attempts in parallel, each limited to 15 minutes and 40,000 output tokens. The agent writes the judge commands with each search; suggest one when you have a measure in mind, for example "try a few approaches and time them with `node bench.mjs`". A trusted project can override single keys in `.pi/branch-search.json`. See [Branch search](branch-search.md) for every key.

## 8. Verify

In a tmux pane inside a project directory, start `pi` and check:

1. The editor shows the model and context status line.
2. `/pair status` reports the pair programmer as on.
3. `/pi-sessions` lists the current session.
4. Ask: `Use an explorer teammate to list the top-level directories.` A teammate starts and reports back. A model-profile error here means a model name in `model-profiles.json` is wrong or not logged in.
5. `/notify-test` shows a notification.

For a checkout install, also run the repository checks:

```bash
cd ~/code/apple-pi
npm run typecheck && npm test
```

## Update and remove

| Install | Update | Remove |
| --- | --- | --- |
| Checkout | `git pull && npm install`, then `/reload` in Pi | `pi remove ~/code/apple-pi` |
| Git package | `pi update --extensions` | `pi remove git:github.com/z3z1ma/apple-pi` |

Update Pi itself with `pi update`.
