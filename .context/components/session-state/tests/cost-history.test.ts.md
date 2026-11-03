## file

A reconnect after an outage reports spend made while the runtime was away as real spend, not a baseline.
Why: treating that spend as a first-sight baseline would hide cost that happened during the outage.
Verify: components/session-state/tests/cost-history.test.ts
