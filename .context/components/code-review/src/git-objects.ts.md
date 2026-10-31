## file

Git owns object storage. The temporary blob store computes candidate identities for batching, then requires Git's own `hash-object` output to confirm every identity before those entries can be used. `cat-file --batch` is length-delimited: blob bytes may contain newlines, NULs and invalid UTF-8. Read only one blob at a time and settle the child when the consumer fails, aborts or ends early.

The batch boundary is measured rather than speculative: the first per-blob-process capture of 4,930 checkout files took 353.7 seconds; the batch version took 21.4 seconds, including artifact verification, and produced identical base/head trees, file entries and patch hashes. These are single local observations, not a latency guarantee. Preserve the batch boundary without inventing a repository-size cap or an independent Git-object implementation.

Coupled: components/code-review/src/capture.ts
Verify: components/code-review/tests/capture.test.ts
