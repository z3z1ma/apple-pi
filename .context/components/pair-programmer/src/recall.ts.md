## file

The root and private pair both call the tool `revisit_note`, but their prompt metadata has different consumers. The root tool is grouped by the composer and has no snippet or guidelines; this binding supplies the private pair's snippet and guidelines explicitly while reusing the root schema and execution.
Why: the private pair does not use the root toolbox. Inheriting prompt metadata from the grouped root definition would silently remove private-session teaching when root metadata is deleted.

Recall resolves the primary session's branch, not the pair's private conversation. The binding substitutes that session manager for execution and for source-image retrieval.
Why: notebook IDs name primary-session evidence; using the private session's branch could miss the note or attach unrelated source material.

Coupled: components/notebook/src/tools/notebook-source.ts, components/system-prompt/src/toolbox.ts
Verify: components/pair-programmer/tests/pair.test.mjs
