## file

Page data is inlined into the built app and escaped so the JSON cannot close its script element.
Why: a title or body containing `</script>` would otherwise end the script and run as HTML.
`readTemplate` reads the built page from `dist/` each time a page tool runs, so a page keeps the page code it was opened with. To test changed page code, open a fresh page; reloading the agent session matters only for changes to the tool's own logic.
Why: an explanation opened before the theme listener existed never synced its theme, which first looked like a defect in the new code.

Coupled: components/browser-pages/src/page-data.ts
Verify: components/browser-pages/tests/page-build.test.ts
