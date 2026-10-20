## symbol:installCoordinator

Pi restores the tool loadout from the saved transcript after building the current extension runtime. A session created before the peer tools existed therefore starts with them registered but inactive, even in a new process with `--coordinator`. The lifecycle hooks restore the coordinator tools when the flag is set; `installPeers` separately restores root peer discovery.
Why: extension registration alone cannot guarantee availability after resuming a saved session; a hook that only removes tools for non-coordinators leaves older coordinators without lifecycle tools.
New peers start without a supplied name so the root TUI session-title extension owns initial naming. Reopens preserve the runtime's stored name.
Why: a CLI-supplied name is treated as an operator rename by session-title and permanently disables its automatic human-name generation for that session.
Coupled: components/session-state/src/peers.ts, components/session-title/src/index.ts, components/session-state/src/runtime.ts
Verify: components/session-state/tests/coordinator.test.ts
