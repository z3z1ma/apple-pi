## file

Nested Edit entries inherit the outer call's file path for source highlighting. The pi_exec code field instead has the fixed language Python; ordinary structured fields remain JSON.
Why: nested edits have no path of their own, and serializing their source strings as JSON first escapes the line breaks and loses readable source formatting. The inspector's display language comes from the tool contract or file path, rather than guessing from arbitrary prose.
Coupled: components/terse-tools/src/content-formatting.ts
Verify: components/terse-tools/tests/render-parity.test.ts
