## file

A stalled subscriber keeps only the newest stream's text and the last end. A newer stream drops an older one's held text. A client that reads gets the text in order, though a burst may arrive coalesced. The bridge keeps flowing while one subscriber reads nothing.
Why: writing every delta to a stalled client queued an entire reply per client; dropping held text at the end truncated replies for clients that were merely behind a burst.
Verify: components/session-state/tests/streaming.test.ts
