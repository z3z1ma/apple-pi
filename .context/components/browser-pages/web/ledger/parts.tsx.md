## symbol:Tree

The `headings` input comes from the ledger app's H2/H3-only navigation filter. Heading level and containing file depth are independent inputs to indentation.

Why: expanding folder nesting must move both section text and its active marker without changing which document sections appear in navigation. A fixture with H1-H6 still produces only two section rows through the app.

Coupled: components/browser-pages/web/ledger/app.tsx, components/browser-pages/web/ledger/styles.css
