## file

Reply streams are never awaited on a subscriber: a client whose socket needs draining is written nothing more until its drain, and meanwhile holds per session only the newest stream's text (one coalesced delta) and the last end. Even a prompt client can fall behind a burst, so an end keeps its own stream's held text; only a newer stream drops an older one's text. Ends of older streams precede new-stream text, while a stream's own end follows its text.

Writing every delta to a stalled client queued an entire reply per client in the runtime's memory; dropping held text at the end truncated replies for clients merely behind a burst (seen as sequence 367 of 400). State stays on the runtime's connections; this extraction only makes the per-event I/O contract mechanically enforceable by its .hot.ts path.

Coupled: components/session-state/src/runtime.ts, components/session-state/src/bridge.ts, docs/session-state.md
Verify: components/session-state/tests/streaming.test.ts
