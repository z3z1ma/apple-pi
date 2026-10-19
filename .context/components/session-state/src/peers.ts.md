## symbol:installPeers

The bridge installs peer discovery only in root sessions, independently of the coordinator flag. Restore its activation at session start and before a turn while preserving the other active tools.
Why: Pi can replace newly registered tools with the saved transcript's older tool set during resume, and session-tree navigation can restore an older set again after startup.
Coupled: components/session-state/src/bridge.ts, components/session-state/src/coordinator.ts
Verify: components/session-state/tests/coordinator.test.ts, components/session-state/tests/peers.test.ts
