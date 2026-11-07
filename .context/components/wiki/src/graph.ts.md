## file

`split("")` is intentional: it keeps UTF-16 width, so regular-expression match indexes stay source columns.

Obsidian treats a fence as code when it sits in a blockquote or immediately after a list marker.

A dotted Obsidian target is an attachment only when it names no real page.
Why: an extension alone must not hide a page whose slug contains a dot.

The graph loader has two current consumers with different read authority: wiki tools retain their existing traversal; Workplace supplies includePath, which is checked before reading an entry or descending into a directory. This keeps excluded Git metadata out of derived warnings and edges, not just out of later content reads. resolveWikiSlug names a case-insensitive filename stem, including dotted slugs. resolveWikiTarget also accepts explicit paths for wiki_references queries; that query grammar is separate from Obsidian page-link identity.
Coupled: apps/agent-workplace/src/backend/knowledge.ts
Verify: apps/agent-workplace/tests/knowledge.test.ts, components/wiki/tests/wiki.test.ts

## symbol:wikiPageExists

Returns whether each Obsidian link target names a wiki page.
Why: callers outside `.wiki/` need the same page check the graph uses, without loading a second link parser.
