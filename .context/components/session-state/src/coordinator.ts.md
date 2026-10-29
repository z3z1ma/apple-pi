## symbol:installCoordinator

Pi restores the tool loadout from the saved transcript after building the current extension runtime. A session created before the peer tools existed therefore starts with them registered but inactive, even in a new process with `--role coordinator`. The lifecycle hooks restore the manager tools for managing roles and unroled recorded organization roots (`managesPeople` from `components/organization`, whose role resolves at session start before this reconcile runs); `installPeers` separately restores root peer discovery.
Why: extension registration alone cannot guarantee availability after resuming a saved session; a hook that only removes tools for non-coordinators leaves older coordinators without lifecycle tools.
New hires omit the name by default so the root TUI session-title extension owns initial naming; an explicitly supplied name opts out. Calling in an ordinary dormant member preserves the runtime's stored name.
Why: a CLI-supplied name is treated as an operator rename by session-title and permanently disables its automatic human-name generation for that session.
A nonempty creator specialization requires the sessions column before hire sends a start; blank or omitted text stays an ordinary hire. The runtime still owns normalization and immutable persistence.
Why: a newer extension can connect to an older daemon, which accepts an unknown start property but discards it. The tool must refuse before creating a person rather than report a specialized hire that never received its focus.
Coupled: components/session-state/src/schema.ts, components/session-state/src/runtime.ts
Verify: components/session-state/tests/specialization.test.ts

Hire trims the optional goal before applying the existing title requirement. Without a nonempty goal it sends no assignment/economic payload and explicitly sends prompt empty; the connected person has its standing role but no automatic opening turn. With a goal it preserves normal assignment and startup behavior. An idle opening is not a universal pause: later live mail or operator input can start a turn.
Why: a role is a standing job, not a placeholder task. Empty goals must not create work records or costs, and omitting a prompt override is not a reliable expression of deliberately idle creation when launch defaults evolve.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/bridge.ts
Verify: components/session-state/tests/idle-hire.test.ts, components/session-state/tests/coordinator.test.ts

`let_go` returns an accepted request reference; the daemon owns the subsequent handoff and retryable cleanup. The native caller's command connection closes at that receipt and is not the job's cancellation owner. Permanent departure and reversible dormancy remain different operations, so `call_in` remains available and `rehire` has no public registration.
Why: waiting for complete cleanup would block the manager on a model run or a failed filesystem/process proof, while cancelling on caller disconnection could undo already-accepted organizational work.
Coupled: components/session-state/src/peers.ts, components/session-title/src/index.ts, components/session-state/src/runtime.ts, components/organization/src/session-role.ts
Verify: components/session-state/tests/coordinator.test.ts, components/session-state/tests/departure-lifecycle.test.ts
