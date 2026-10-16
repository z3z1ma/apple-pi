## symbol:Sidebar.__init__

Keep `ansi_color=True` together with `Screen { background: ansi_default; }`.
Why: the operator's Ghostty background is translucent. With `ansi_color` unset, Textual's ANSI-to-truecolor filter turns the default background into the theme's solid background, and the pane shows as an opaque block.

## symbol:Sidebar.on_mount

`text-muted` is overridden with a solid colour in the registered theme.
Why: the built-in `text-muted` has alpha. Over `ansi_default` it blends against the theme background, not the real terminal, so muted markup text rendered at full brightness.

## symbol:Sidebar.paint_pill

The "previous" arrow calls `app.variant(2)`, not `app.variant(-1)`.
Why: Textual markup `@click` arguments reject a negative literal (`MarkupError`). Key bindings accept `variant(-1)`; with three variants, `+2` wraps to the same place.

## symbol:Lanes.compose

Children of `Lanes` are found by class (`.hero-count`, `.head-<lane>`, `.lane-body-<lane>`), never by id, and queried through `self`.
Why: `Lanes` is composed twice in one DOM (`Lanes` and its subclass `Merged`). Ids would repeat, so `#id` CSS and app-wide queries would match both copies.

## file

Textual writes its screen to stderr. A launcher that redirects stderr leaves the pane blank.
Coupled: .ledger/history/202610152308-tmux-agent-tracking/prototype/run.sh
