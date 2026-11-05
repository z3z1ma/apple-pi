## file

Every colour is a `--wp-*` variable so themes from Settings repaint the Git app; the workplace palette rule refuses literal colours here. Lane colours are the one exception and live in workplace-git.tsx (SVG strokes and fills), chosen to stay readable on both light and dark panels.
Why: a literal colour in this sheet breaks every non-house theme.

The layout is three columns (branches, graph or diff, details) with usePaneResize separators on the outer two. Each column scrolls on its own; the commit form stays pinned at the bottom of the details column. Commit rows are a fixed-height CSS grid whose first column width comes from `--wp-gitx-graph`, set from the widest lane count, so lane SVGs and text columns line up across rows. Below 1100px the author column keeps only its avatar and the SHA column and toolbar captions hide.
Why: a fixed row height is what lets each row's SVG segment join its neighbours into continuous lanes.
Coupled: apps/agent-workplace/web/workplace-git.tsx, apps/agent-workplace/web/workplace.css
Verify: apps/agent-workplace/tests/world-git.test.ts
