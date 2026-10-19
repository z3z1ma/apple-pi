# 09: Batched history reads in the runtime

**What to build:** The runtime returns a session's transcript entries in batches or pages, keyed by the ordered ids in its messages index, so a long transcript is not scanned once per entry.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] In the session-state runtime tests, one request returns a page of entries in transcript order, with a cursor to the page before.
- [x] A transcript of several thousand entries is read page by page without rescanning the file per entry, which a test shows by counting reads.
- [x] Existing single `read_entry` callers keep working.
