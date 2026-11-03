## file

Consume the exported lineReader callback as JSON, as the socket clients do. Assert completion timing and decoded message order rather than exact raw JSON whitespace.
Why: network chunks do not align with message boundaries, while JSON formatting whitespace is not part of the wire message's meaning. A harmless trim must not fail these framing tests, but emitting a partial or blank frame must fail JSON parsing.
Coupled: components/session-state/src/protocol.ts, components/session-state/src/client.ts
Verify: components/session-state/tests/protocol.test.ts
