## file

The ordinary configuration keeps UnsafeCommit false. The retained negative-control trace comes from overriding that constant to true, which removes only the current close-authority recheck at Commit. Reproduce both outcomes after a model or configuration change and refresh the verdict/trace counts in lifecycle-design.md together.

Why: a normal pass without the control could hide a broken assertion or unreachable departure; the control's violation is intentional design evidence rather than a runtime defect. CHECK_DEADLOCK FALSE limits this configuration to its listed safety invariants: blocked work may wait forever, and neither eventual cleanup nor fairness is checked.

Coupled: .ledger/history/202611031649-persistent-versus-automatic-lifetime-organizations/organization-lifecycle.tla, .ledger/history/202611031649-persistent-versus-automatic-lifetime-organizations/lifecycle-design.md
Verify: .ledger/history/202611031649-persistent-versus-automatic-lifetime-organizations/lifecycle-pass.txt, .ledger/history/202611031649-persistent-versus-automatic-lifetime-organizations/lifecycle-control.txt
