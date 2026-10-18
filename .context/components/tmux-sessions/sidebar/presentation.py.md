## symbol:use_theme

`text-muted` is overridden with a solid colour in the registered theme.
Why: the built-in `text-muted` has alpha. Over an `ansi_default` screen it blends against the theme background, not the real terminal, so muted markup text rendered at full brightness.
Coupled: components/session-state/src/attention.ts

`STATUS_STYLE` and the runtime's status-line colours in `attention.ts` repeat this theme's warning, success, primary, and muted colours by hand, because Rich text and the tmux status line have no Textual theme.
