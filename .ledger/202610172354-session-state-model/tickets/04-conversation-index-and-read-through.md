# 04: Conversation index and read-through

**What to build:** Every completed message and tool call is indexed in the database (session, entry id, role, time, tool, size, short preview), and a consumer can ask the runtime over the socket for the full text of an entry, which the runtime reads from Pi's session JSONL.

**Blocked by:** 01 Runtime and bridge tracer

**Status:** done

- [x] After a faux session completes a user turn with one tool call, the database has index rows for the user message, the assistant message, the tool call, and its result, each with entry id, role, time, size, and a short preview.
- [x] Asking the runtime over the socket for one of those entry ids returns the same full text that is in the session's JSONL file.
- [x] No full message text is stored in the database beyond the preview.
- [x] Asking for an unknown entry id returns a clear not-found answer.
