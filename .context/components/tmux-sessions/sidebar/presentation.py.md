## symbol:use_theme

`text-muted` is overridden with a solid colour in the registered theme.
Why: the built-in `text-muted` has alpha. Over an `ansi_default` screen it blends against the theme background, not the real terminal, so muted markup text rendered at full brightness.
Coupled: components/tmux-sessions/sidebar/agents.py

The status-line colours in `agents.STATUS_STYLE` repeat this theme's warning, success, primary, and muted colours by hand, because the status line is plain tmux format text with no Textual theme.
