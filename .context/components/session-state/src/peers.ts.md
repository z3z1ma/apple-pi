## symbol:installPeers

The bridge installs peer discovery in every root session, not only managers. Restore its activation at session start and before a turn while preserving the other active tools.
Why: Pi can replace newly registered tools with the saved transcript's older tool set during resume, and session-tree navigation can restore an older set again after startup.
Coupled: components/session-state/src/bridge.ts, components/session-state/src/coordinator.ts
Verify: components/session-state/tests/coordinator.test.ts, components/session-state/tests/peers.test.ts

## symbol:readDirectory

The person tool and its pair share this read-only projection. The pair passes the main person's id; its own private session has no organization row. Only the person-facing manager view includes the backlog.

Coupled: components/pair-programmer/src/second-opinion.ts
Verify: components/pair-programmer/tests/second-opinion.test.ts

## symbol:directoryView

The model reads a roster, one line per person, and the full record only for one `person` at a time; `details` keeps the whole projection.
Why: the record grows with every finished assignment and was printed whole for everyone. One manager's directory call reached 242K characters (about 60K tokens), mostly outcome text, while the charter tells managers to check the directory often.
Verify: components/session-state/tests/peers.test.ts
