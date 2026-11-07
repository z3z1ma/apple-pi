## file

This is a proposed finite safety design, not a model derived from a completed organization-lifetime implementation. Cancellation invalidates future departure commits; it leaves already committed child departures and their file cleanup intact. Root-last ordering waits for report records to be removed, including reports whose permanent marker already exists. Keep candidate selection, permanent departure, writer exit, file unlink and record removal separate when refining the model.

Why: combining selection with departure would erase the reopen/move/work-arrival race; combining the permanent marker with row removal would hide crash recovery and falsely suggest that reopening can restore deleted people. The existing runtime's permanent departure and program disposal are different lifecycles, so the temporary peer uses its own action rather than classifying lasting people as temporary.

The epoch bound permits close, reopen and another close; it bounds exploration rather than asserting arbitrary-incarnation correctness. SplitLeaf retains the source organization's incorporation, per operator decision 13518. Unassigned backlog is intentionally outside held work and does not block cleanup. Exact process identity, late writers, migration, root-wide merges and task anchoring remain outside this model. The companion document maps the settled design to implemented owners without claiming extraction/refinement proof.

Coupled: .ledger/history/202611031649-persistent-versus-automatic-lifetime-organizations/organization-lifecycle.cfg, .ledger/history/202611031649-persistent-versus-automatic-lifetime-organizations/lifecycle-design.md, components/session-state/src/departures.ts, components/session-state/src/program-peers.ts
Verify: .ledger/history/202611031649-persistent-versus-automatic-lifetime-organizations/lifecycle-pass.txt, .ledger/history/202611031649-persistent-versus-automatic-lifetime-organizations/lifecycle-control.txt
