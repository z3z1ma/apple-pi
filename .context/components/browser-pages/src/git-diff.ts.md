## file

Git diffs non-UTF8 text line by line. Decoding it would replace bytes, so such a file is shown as binary. A mutable capture's head is a snapshot, not the commit its checkout was on. Sign-off limits a retained capture to the reviewed paths; an explanation shows the whole capture so changed context is not labelled unchanged.
Why: a lossy decode would present altered source as the change, and a capture head is not a branch tip.

Paths limit the diff. Files outside that list can still be read as surrounding context. A file with no text lines carries a reason such as "Binary file" instead of invented lines.
Why: the review can cite a neighbouring file without treating it as part of the change.
Coupled: components/browser-pages/src/code-review.ts
Verify: components/browser-pages/tests/code-review.test.ts
