## symbol:Sidebar.__init__

Keep `ansi_color=True` together with `Screen { background: ansi_default; }`.
Why: the operator's terminal background is translucent. Without `ansi_color`, Textual's ANSI-to-truecolor filter turns the default background into the theme's solid background, and the pane shows as an opaque block.

## symbol:Sidebar.on_mount

`text-muted` is overridden with a solid colour in the registered theme.
Why: the built-in `text-muted` has alpha. Over `ansi_default` it blends against the theme background, not the real terminal, so muted markup text rendered at full brightness.

## file

Textual writes its screen to stderr. A launcher that redirects stderr leaves the pane blank.
Coupled: components/tmux-sessions/scripts/sidebar.sh
Verify: components/tmux-sessions/sidebar/tests/test_sidebar.py
