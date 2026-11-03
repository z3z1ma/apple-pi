## file

The fixture registers a `finish_task` name because reflection only needs that name. The session-state work tools own the real tool.
Why: installing the work tools here would pull the runtime into a prompt test.

The system prompt keeps its previous self until compaction rebuilds the context. A later start can draw a soul that the first prompt did not have.
Why: asserting the new self on the next prompt, before compaction, would fail a prefix that is supposed to hold.
Verify: components/organization/tests/person.test.ts
