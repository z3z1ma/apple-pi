## file

The shell and card styles (`wp-rv-*`) come first, then the evidence-view styles (`wp-review-*`) that workplace-review-views.tsx shares, then analytics and the capture dialog. Every colour is a `--wp-*` variable. The bare-button reset uses `:where(.wp-reviews)` so class rules such as `.wp-rv-primary` win; an earlier `.wp-reviews button { font: inherit; color: inherit }` outranked them, enlarging toolbar buttons and putting light text on the light dark-mode accent. Primary actions use the house green (`--wp-green`), as `.wp-primary` does elsewhere.
Coupled: apps/agent-workplace/web/workplace-reviews.tsx, apps/agent-workplace/web/workplace-review-views.tsx, apps/agent-workplace/web/workplace-dialog.css
Verify: apps/agent-workplace/tests/world-reviews.test.ts
