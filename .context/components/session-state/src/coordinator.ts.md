## symbol:installCoordinator

Pi restores the tool loadout from the saved transcript after building the current extension runtime. A session created before the peer tools existed therefore starts with them registered but inactive, even in a new process with `--coordinator`. The lifecycle hooks restore the coordinator tools when the flag is set; `installPeers` separately restores root peer discovery.
Why: extension registration alone cannot guarantee availability after resuming a saved session; a hook that only removes tools for non-coordinators leaves older coordinators without lifecycle tools.
Coupled: components/session-state/src/peers.ts
Verify: components/session-state/tests/coordinator.test.ts
