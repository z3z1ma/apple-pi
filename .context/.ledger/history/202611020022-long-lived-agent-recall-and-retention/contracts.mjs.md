## file

These assertions characterize the inspected implementation, including defects; they are research counterexamples rather than the desired permanent product contract.
Why: after an approved search fix, a failed assertion can mean the defect was removed. Moving these assertions unchanged into production regression tests would preserve the wrong behavior.

Keep fixtures synthetic and pass a manager facade to the tool rather than opening a real session.
Why: the inquiry authorizes observation, not transcript migration or repair, and these probes need no private history.
Coupled: components/session-search/src/tool.ts, components/session-search/src/search-entries.ts, .ledger/history/202611020022-long-lived-agent-recall-and-retention/evidence.md
