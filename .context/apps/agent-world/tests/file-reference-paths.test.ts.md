## file

These tests cover the exported pure parsing/target-selection boundary: preserved displayed token ranges, valid editor locations, exact filename precedence, and accepted local URI forms. Location and accepted-URI tests assert the final target selected from validated files rather than only the intermediate candidate shape. The quoted-space test checks returned ranges against unchanged delimiters; actual rendered text and activation remain browser-test responsibilities.
Why: a parser can emit plausible candidates while target selection still opens the wrong colon-named file or discards a requested position. Pure tests do not establish DOM safety, keyboard navigation, actual caret placement or retained drafts; those belong to the built-browser suite, while filesystem containment belongs to backend tests.
Coupled: apps/agent-world/web/file-reference-paths.ts, apps/agent-world/web/file-references.tsx
Verify: apps/agent-world/tests/world-file-links.test.ts, apps/agent-world/tests/workspace-backend.test.ts
