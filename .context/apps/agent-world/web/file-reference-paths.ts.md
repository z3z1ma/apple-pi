## file

Parsing proposes metadata candidates, not filesystem authority. Keep the original spelling beside any positive line/column alternative; resolvedFileReference chooses an existing literal first, because colon digits are legal filename characters. Only a stripped match carries a caret location. Backend validation must still establish canonical root/path containment for every returned target.

Local file URLs accept file:/// and file://localhost/ only, without remote hosts, query or fragment. Other URL schemes are not candidates. Home expansion belongs to the backend, not this renderer parser. Unquoted prose uses path-shaped tokens and separates sentence punctuation. Single/double quotes and backticks identify whole candidates, including embedded spaces; their delimiters stay outside the token range. Metadata decides whether an explicitly delimited candidate is a real file. These delimiters are not shell syntax: escapes, expansion and command parsing are not introduced.
Why: a filename such as notes.md:12 can be a real file rather than line 12 of notes.md. Parsing alone cannot decide; selecting from validated alternatives preserves the intended file without granting filesystem access.
Coupled: apps/agent-world/web/file-references.tsx, apps/agent-world/src/backend/workspace.ts
Verify: apps/agent-world/tests/file-reference-paths.test.ts, apps/agent-world/tests/world-file-links.test.ts
