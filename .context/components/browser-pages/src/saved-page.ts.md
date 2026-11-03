## symbol:savedPage

Page data is inlined into the built app and escaped so the JSON cannot close its script element.
Why: a title or body containing `</script>` would otherwise end the script and run as HTML.
Coupled: components/browser-pages/src/page-data.ts
Verify: components/browser-pages/tests/page-build.test.ts
