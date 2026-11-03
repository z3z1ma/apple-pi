## file

Pi writes most JSONL entries with their own `"type","id","parentId","timestamp"` first on the line, but `custom_message` and `custom` entries write their payload first and their own `"id","parentId","timestamp"` last, and a payload (`details`) can hold other `"id"` fields. An entry is identified only by the anchored head pattern or the anchored tail pattern, never by the first `"id":"` on the line.
Why: the earlier runtime scan took the first `"id"` on each line and silently missed every mail entry, which Workplace then showed as `missing`.

Pi appends entries in time order, so a backward read from the end stops as soon as a line is older than the oldest wanted entry; this is what keeps opening a long DM fast on a transcript of hundreds of megabytes. Identification reads only the first and last 512 bytes of a line. A wanted id with no indexed time does not set that age floor, so the read continues until that entry is found.
Why: the entry's own id and timestamp sit at one end of the line, and a missing index time must not stop the scan before that entry.
Coupled: components/session-state/src/transcript-index.hot.ts
Verify: components/session-state/tests/transcript-read.test.ts
