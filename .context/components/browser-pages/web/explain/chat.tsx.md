## symbol:Grip

`Grip` writes the sidebar width as `--chat-w` on the sidebar's parent element, and `.ex-body.chat-open` in `styles.css` reads it for the grid's third column. Keep the `<aside>` a direct child of `.ex-body`.
Why: a wrapper around the sidebar puts the variable on the wrong element, and resizing then does nothing, with no error.

The arrow keys step from the set `--chat-w`, not the rendered width.
Why: the grid column animates toward a new width, so a second key press during the animation read a stale width (two presses gave 760px, not 720px).

Coupled: components/browser-pages/web/explain/app.tsx, components/browser-pages/web/explain/styles.css
