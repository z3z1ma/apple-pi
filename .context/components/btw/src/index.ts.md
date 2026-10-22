## file

The creation promise is also the conversation's identity. A reset detaches it before waiting, so late creation cannot open an overlay or advance the new parent's snapshot cursor. Pending close promises stay reachable until settled: a shutdown overlapping an earlier clear must await the same cleanup even though the active slot is already empty.

Parent context is captured once per overlay visit and consumed by its first accepted question. Subsequent visits append only new text; they never rewrite the private transcript. Question envelopes keep slash-led questions literal during both initial prompts and steering. Answer injection is an explicit operator action and uses follow-up delivery while the parent is busy.

Coupled: components/btw/src/session.ts, components/btw/src/context.ts, components/btw/src/ui/viewer.ts, docs/btw.md
Verify: components/btw/tests/command.test.ts, components/btw/tests/context.test.ts, components/btw/tests/session.test.ts
