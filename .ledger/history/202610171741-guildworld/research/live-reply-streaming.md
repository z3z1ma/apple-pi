# Live reply streaming research

## Scope and sources

Installed package inspected: `@earendil-works/pi-coding-agent` **1.2.0** (package.json); Pi AI declarations from installed `@earendil-works/pi-ai` (package version not verified). Local implementation references are the current working tree. No upstream files needed.

## What Pi emits

- Extension API declares `message_start` for user/assistant/toolResult messages, `message_update` “during assistant message streaming with token-by-token updates” carrying both `message: AgentMessage` and `assistantMessageEvent`, and `message_end` with the finalized message: `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:837-850`.
- The event family from `node_modules/@earendil-works/pi-ai/dist/types.d.ts:557-613` includes `start`, `text_start`, `text_delta` (`delta` plus `partial`), `text_end` (`content` plus `partial`); corresponding thinking start/delta/end and toolcall start/delta/end; then `done` or `error`. The documented contract says `partial` is shared live response-so-far, text/thinking blocks grow through deltas until end, and tool-call arguments at start are provider-specific while `toolcall_delta` carries subsequent JSON updates.
- Practical client behavior: render only `text_delta.delta` as new visible reply text (or use `partial` as replacement snapshot, never append snapshots). Thinking deltas and tool argument JSON are separate channels and need not be displayed as reply prose. Pi’s `message_update` wraps the individual assistant event (`extensions/types.d.ts:842-846`).
- `agent-session.js:905-925` routes start/update/end extension events; `agent-session.js:752-756` emits extension events before persistence handling; `:756-...` handles `message_end` persistence. Updates are event-driven, once per underlying stream update; neither these declarations nor code establishes a fixed timer/token cadence. Do not assume a particular frequency or one update per token.
- Stream-time `AssistantMessage` has no session entry id in the event contract. In contrast, `TurnEndEvent` declares `messageEntryId` and `toolResultEntryIds` (`extensions/types.d.ts:825-835`); use a stable client-generated stream id (session + generation + monotonically increasing sequence, or UUID) while streaming, then send an explicit completion mapping to the persisted `messageEntryId`, or identify the matching new transcript row at turn end. The bridge currently discovers ids after persistence, not at message end.

## Current bridge/runtime and minimum transient path

- Bridge currently listens to `message_start` to set `thinking` for assistant messages (`components/session-state/src/bridge.ts:618-624`), and on `message_update` only checks event type `text_start` / `text_delta` to set `writing_reply` (`:626-629`). It does not forward text. `message_end` updates cost/error facts only (`:630-637`).
- The bridge already has a newline-delimited JSON Unix-socket link and typed `BridgeMessage`; `StateLink.send` writes JSON directly (`bridge.ts:30-160`; protocol `components/session-state/src/protocol.ts:161-174`). Smallest conceptual addition: a transient `reply_delta`/`reply_snapshot` protocol variant containing session identity (implicit on the bridge connection), generation, stream id, sequence, and text delta (optionally channel); emit it from bridge on text deltas. Runtime handles it by broadcasting to currently subscribed client sockets, without inserting into `events`/`messages` SQLite tables. This preserves the distinction in docs: streamed text currently writes no events (`docs/session-state.md`, “What it records”).
- Runtime accepts bridge connections and dispatches messages by type (`components/session-state/src/runtime.ts:262-...`); its `Connection` has session/generation identity (`:48-...`). Add client subscription semantics or broadcast to all client-role sockets, not bridges; existing connections represent both roles in practice, so an explicit subscribe handshake/filter is needed to avoid echoing deltas to bridges/unrelated clients. Filter stale generations as `setRunState` does (`runtime.ts:790-...`).
- Completion: index rows use transcript `entryId`, `part: ""` for an assistant message (`bridge.ts:282-...`), and current bridge indexes only on `turn_end`, settle and a one-second watcher (`:435-448`, `:638-642`, `:688`). Have the transient completion carry stream id and `messageEntryId` from Pi `turn_end` (or let the client match an indexed assistant entry) so it can replace/remove the ephemeral bubble with the canonical transcript item. IDs are not present in `message_update`.

## Efficient history reads

- `read_entry` is one id per request (`components/session-state/src/protocol.ts:76-83`). Runtime fetches the session file path, reads the **entire** UTF-8 JSONL via `readFile`, splits all lines, then searches candidate lines for matching parsed `entry.id` (`components/session-state/src/runtime.ts:664-690`): O(total transcript bytes) per entry request.
- `messages` is the completed-conversation index keyed by `(session_id, entry_id, part)` (`components/session-state/src/schema.ts:100-112`); bridge rows retain transcript entry IDs, timestamp, role, size and preview (`protocol.ts:66-74`; bridge `indexRows`, `:282-...`). Querying `messages` can page ordered metadata/IDs efficiently (define deterministic ordering, e.g. `at, rowid` or add sequence); it does not contain full JSON entries.
- For batched reads, extend request/reply with ordered entry IDs (or cursor + limit), look up transcript entries together. For efficient payload retrieval, add byte offsets/lengths per JSONL entry to the index and seek only requested line ranges, or build an in-memory/file offset map; current index does not store offsets, and the package’s session manager owns JSONL writes. Offset tracking must account for concurrent append/partial final lines and any file rewrite/truncation, and must use UTF-8 byte offsets rather than JS character indices. Alternative: maintain an index populated while scanning JSONL, but that still needs an initial scan.

## Risks and options

- **Volume/rate:** a reply may produce many updates; JSON-lines per event increases serialization and socket traffic. Batch/coalesce deltas on a short timer or send snapshots periodically; sequence numbers make dropped/coalesced updates detectable. No verified native rate limit.
- **Back-pressure:** current `StateLink.send` calls `socket.write` without observing its boolean return/drain (`bridge.ts:158-160`); a slow client can queue memory if broadcast is unbounded. Bound/coalesce transient buffers; do not stall Pi’s stream callback awaiting consumers.
- **Multiple clients:** subscriptions need per-client filtering, cleanup on close, and bounded fan-out. Full transcript reads stay request/reply on requesting socket, distinct from transient broadcasts.
- **Children:** docs say bridge loads in interactive child sessions, and a child is a distinct session running in parent process (`docs/session-state.md`, “Parts” and “What it records”). Treat each child’s stream as its own session/generation; do not presume root-only. Internal `/btw` does not load bridge. Fanout/subscription should filter by requested session IDs.

### Options (not a decision)

1. Broadcast each delta with sequence; simplest and lowest latency, highest traffic.
2. Coalesce deltas and broadcast snapshots/delta batches; lower traffic with small display latency.
3. Keep streaming on demand: clients subscribe to session IDs, runtime fans out transient messages only to those clients; pair with either 1 or 2.
4. Independently improve history with SQL-paged IDs plus batched `read_entry`; add byte offsets only if measurements justify offset maintenance.
