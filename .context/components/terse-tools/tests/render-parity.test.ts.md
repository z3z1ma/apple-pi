## file

Diff-style tests supply deterministic terminal styling at Pi's public `Theme.inverse` boundary and assert the rendered transcript, inspector, and pending Edit preview.
Why: native text attributes depend on terminal color detection; a headless test can otherwise lose emphasis before it reaches our renderer. The fixture supplies native input styling, rather than mocking the diff formatter or asserting that a particular method was called.

Check background and inverse styling on diff content rows, while positively checking bold changed words and retained line colors.
Why: a plain-text preview also has no inverse video, so a negative-only assertion misses lost emphasis; inspector chrome can legitimately use a background without highlighting changed words.
Coupled: components/terse-tools/src/content-formatting.ts, components/terse-tools/src/formatters.ts, components/terse-tools/src/tool-viewer.ts
Verify: components/terse-tools/tests/render-parity.test.ts
