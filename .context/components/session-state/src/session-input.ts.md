## file

Wrappers belong to each actual AgentSession, using the existing live-session binding. Entry accounting and the seal belong to the process launch together. Count the entire promise, including preparation before agent_start, abort/dispose and eventual rejection/settlement. An earlier object's held preparation remains counted when a replacement looks idle. Host idleness and disposal alone do not settle that promise. Passive custom messages stay passive.

The boundary covers prompt, steer, followUp, turn-triggering custom messages, executeBash, navigateTree, compact, reload and summarizeForBugReport before their first await. Native tree/compaction hooks provide zero-provider-request asynchronous controls, not stand-ins for those entry methods. Methods that only cancel/settle work remain available while sealed.

One process-scoped latch survives extension reload and replacement objects during new/resume/fork. An existing ticket accepts only its own repeat seal and matching release. Clearing on session_shutdown or stealing a ticket would let fresh work cross an older proof. Fresh hello invalidates same-launch proofs before releasing the retained ticket. This is one launch value, not a registry, environment variable or transcript store.

A legacy latch without launch-wide pending accounting stays unknown until process exit, even after newer entries settle. Resetting it to zero would lose older code's object-local preparation. Both a retained old adapter and a new adapter over unknown legacy state have no strengthened scope. The bridge withholds both quiescence capability and startup launch authority in that case. Existing processes need current code from launch to certify the new contract.

Coupled: components/session-state/src/bridge.ts, components/session-state/src/runtime.ts, components/shared/src/forked-continuation.ts
Verify: components/session-state/tests/session-input.test.ts, components/session-state/tests/organization-lifetime.test.ts
