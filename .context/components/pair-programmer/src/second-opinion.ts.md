## file

The private pair session is not an organization member. Bind both tools to the main session's identity, so directory lookup and mail attribution refer to the person being paired with.

`managerAddress` normally falls back to the operator for `escalate`. A second-opinion request deliberately differs: at a root, the pair names a recipient itself; only an explicit `operator` address contacts the human. A blank `to` is rejected rather than bypassing that distinction. This keeps a missing manager from silently turning ordinary pair uncertainty into operator mail.

Requests are staged by PairRuntime, not sent while a model tool call is still inside an incomplete review. Once committed to the runtime, the thread is ordinary mail: the recipient's reply is pushed to the main session, not returned to this tool.

Coupled: components/pair-programmer/src/extension.ts, components/session-state/src/addresses.ts, components/session-state/src/mail.ts
Verify: components/pair-programmer/tests/second-opinion.test.ts, components/pair-programmer/tests/pair.test.mjs
