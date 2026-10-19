Type: research
Status: resolved
Blocked by:

# Live reply streaming

## Question

What must the session-state bridge and runtime add so Agent World can show a character's reply as it is written, and read conversation history efficiently?

Find what Pi's extension API exposes while a reply streams (`message_update` and related events), how partial text could reach a client without becoming durable events (a transient stream over the socket, or something else), how a client reconciles it with the completed transcript entry, and what `read_entry` needs for paging through a long transcript (it scans the whole JSONL today). Record findings in `research/` and link them here.

## Answer

Findings: [research/live-reply-streaming.md](../research/live-reply-streaming.md).

- Pi already emits what is needed: `message_update` carries each assistant stream event (`text_delta` with `delta` and `partial`, plus separate thinking and tool-call channels), with no fixed cadence. The bridge today only uses it to set `writing_reply`.
- The smallest addition is a transient bridge message (stream id, sequence, text delta) that the runtime relays to clients subscribed to that session, never written to `events` or `messages`. A client replaces its ephemeral bubble with the transcript entry at `turn_end`, which names `messageEntryId`; stream events carry no entry id.
- Needed alongside: an explicit client subscribe handshake (connections are not typed as bridge or client today), back-pressure or coalescing (the bridge writes without watching drain), and per-session filtering, children included.
- History: `read_entry` reads the whole JSONL per id. Page ordered ids from the `messages` index and batch reads; add byte offsets only if measurements show the need.
- The channel choice (every delta, coalesced batches, on-demand subscription) is left to the spec.
