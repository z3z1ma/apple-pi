## file

Any word may match; entries holding more of the words rank first. A rewritten file starts over rather than keeping rows for entries it no longer holds. An assistant message with no text still takes an ordinal; a custom message does not. Each hit's offset and length are exactly its line.
Why: a reader that scans for the body, or that keeps stale rows after a rewrite, would return the wrong entry.
Verify: components/session-state/tests/transcript-index.test.ts
