## file

`SseProgress` recognizes a complete non-ping SSE event and then forgets the event body.
Why: progress only needs event boundaries. Retaining payloads would copy request data the watchdog must not store.

Verify: components/anthropic-watchdog/tests/watchdog.test.ts
