## file

The backend API runs in Node, without Electron, over a real session-state runtime. Characters stay in the order their sessions started. A scratch tmux server is never the operator's: `tempStateDir` points `TMUX_TMPDIR` at its own directory. The runtime reads tmux once a second before a pane's session and window are known. View bookkeeping is not news. A client showing the pane makes every view agree the operator saw it. The first update carries everything; a later update where only an awake character changed leaves the inn and mail out. When a session stops, the inn goes out whole with the new sleeper, and the mail stays out.
Why: reordering characters when someone leaves would move figures the operator is watching.

The permanent-departure case uses the recorded departure event as a fixture synchronization barrier, then stops the fake bridge before asserting public snapshot removal from both awake and dormant rosters and the reduced team headcount. The lifecycle receipt is acceptance, not completion. The stand-in bridge does not automatically quit when the runtime requests departure; a snapshot-only wait before stopping it therefore stalls.
Why: the barrier lets the asynchronous departure commit before the fixture performs the shutdown a real bridge would handle. The observable contract remains removal from the retained roster after departure, distinct from ordinary at-home state; the event query is harness sequencing rather than a new product requirement.
Coupled: apps/agent-workplace/src/backend/lifecycle.ts, apps/agent-workplace/src/backend/world-backend.ts, components/session-state/src/runtime.ts
Verify: apps/agent-workplace/tests/backend.test.ts
