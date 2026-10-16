## symbol:Grip

`Grip` writes the sidebar width as `--chat-w` on the sidebar's parent element, and `.ex-body.chat-open` in `styles.css` reads it for the grid's third column. Keep the `<aside>` a direct child of `.ex-body`, and the contents column its first child: the width cap measures that column.
Why: a wrapper around the sidebar puts the variable on the wrong element, and resizing then does nothing, with no error. A cap without the contents column let the article shrink to 370px at a 1440px window.

The cap never falls below 420px, the default width in `styles.css` (`var(--chat-w, 420px)`); change both together.
Why: on a narrow window the default already leaves the article less than 480px, so a lower cap made a drag to widen the sidebar shrink it.

The arrow keys step from the set `--chat-w`, not the rendered width.
Why: the grid column animates toward a new width, so a second key press during the animation read a stale width (two presses gave 760px, not 720px).

Coupled: components/browser-pages/web/explain/app.tsx, components/browser-pages/web/explain/styles.css
