## file

`split("")` is intentional: it keeps UTF-16 width, so regular-expression match indexes stay source columns.

Obsidian treats a fence as code when it sits in a blockquote or immediately after a list marker.

A dotted Obsidian target is an attachment only when it names no real page.
Why: an extension alone must not hide a page whose slug contains a dot.

## symbol:wikiPageExists

Returns whether each Obsidian link target names a wiki page.
Why: callers outside `.wiki/` need the same page check the graph uses, without loading a second link parser.
