## file

Load the actual default adapter through Pi's extension loader and assert its exported tool surface. Root discovery now uses the same session-search entrypoint that interns already load explicitly; preserve its path export and manifest position when changing the adapter.
Why: testing only the installer function or a forwarding wrapper would miss an incorrect default entrypoint or accidental extra model tools. The removed context.ts filename is not a second supported adapter.

The checks cover registration and the search-versus-notebook hook separation, not a complete installed package, tool execution or a private pair-model turn. Keep package-loader and search execution evidence separate.
Why: a loader fixture can show which tools/hooks were registered without proving runtime prompts, results or provider behavior.

Coupled: extensions/session-search.ts, package.json, components/interns/src/runner.ts
Verify: tests/session-search-extension.test.ts, tests/session-search-standalone.test.ts, tests/package-load.mjs
