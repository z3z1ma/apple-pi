## file

Hooks are set at the fixed array index `71`, never appended.
Why: the Pi extension may run this file again (an updated plugin reloads), and `set-hook -ga` would add a duplicate each time. A fixed index replaces the plugin's own hook and leaves the operator's hooks on the same events alone.
Coupled: components/tmux-sessions/src/index.ts

When testing on a scratch tmux server, do not set `window-size manual`: tmux 3.5a crashes on `new-window` in a detached session with that option.
