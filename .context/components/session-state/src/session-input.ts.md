## file

Entry accounting and wrappers belong to an actual AgentSession object, using the existing live-session binding. It wraps entry to prompt, steer, followUp, turn-triggering custom messages and executeBash before their first await. Count the entire promise, including extension-command/input/auth preparation before agent_start and cleanup through rejection. Host isIdle alone excludes none of that preparation. Passive custom messages stay passive.

One process-scoped seal ticket survives both extension reload and a replacement AgentSession object during new/resume/fork. A per-object-only ticket failed the two-real-SDK-object control and would let preparation cross the old runtime proof before hello. Clearing it on session_shutdown would let new input cross a still-authorized runtime proof before the socket disconnect is observed. A fresh hello invalidates prior same-launch proofs before releasing the exact retained ticket. Stale releases leave a newer seal intact. This is one launch-lifetime latch, not a registry, environment variable or new transcript. Exact release clears the ticket; the process owns its remaining lifetime. A missing live-session binding cannot advertise this capability.

Coupled: components/session-state/src/bridge.ts, components/session-state/src/runtime.ts, components/shared/src/forked-continuation.ts
Verify: components/session-state/tests/session-input.test.ts, components/session-state/tests/organization-lifetime.test.ts
