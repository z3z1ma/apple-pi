## symbol:useOutsideWrite

`confirm` passes back the token and the intent exactly as `describeWrite` got them; the gate refuses any other pairing, so the intent must not be rebuilt from the form between asking and confirming (an edited draft would be a different write). A sent entry reaches `chatLines.write` both from the answer and from the gate's announcement; `chatLines` keeps one line per entry.
Coupled: apps/agent-world/src/backend/integrations/gate.ts, apps/agent-world/web/overlay/interface/chat-lines.ts
Verify: apps/agent-world/tests/world-forge.test.ts, apps/agent-world/tests/integrations/github.test.ts
