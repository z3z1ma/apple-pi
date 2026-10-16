## symbol:Sidebar.__init__

Keep `ansi_color=True` together with `Screen { background: ansi_default; }`.
Why: the operator's terminal background is translucent. Without `ansi_color`, Textual's ANSI-to-truecolor filter turns the default background into the theme's solid background, and the pane shows as an opaque block.
Coupled: components/tmux-sessions/sidebar/dashboard.py

## symbol:Sidebar.poll

A failed poll shows one error toast and keeps the last agents; it never ends the app.
Why: the sidebar is meant to stay open around the clock, and a crash closes its pane, which then has to be reopened by hand.

## file

Textual writes its screen to stderr. A launcher that redirects stderr leaves the pane blank.
Coupled: components/tmux-sessions/scripts/sidebar.sh
Verify: components/tmux-sessions/sidebar/tests/test_sidebar.py
