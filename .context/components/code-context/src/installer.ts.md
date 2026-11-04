## symbol:installCodeContext

A top-level read receives the source file's context file. A top-level edit or write stays blocked until that context file's current marker is in the model's context.
Why: calls made by a tool such as `codemode` or a saved program carry `parentToolCallId`. Those calls get the raw read and no gate. A whole read of the context file already shows its content, and a mutation of it was just made, so that result does not append the file again.

## symbol:effectiveMessages

What the model sees now is a fork's own conversation, or the session's compaction-aware branch.
