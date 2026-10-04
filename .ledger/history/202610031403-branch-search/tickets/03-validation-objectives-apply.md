# 03: Validation, objectives, and automatic apply

**What to build:** Before any enumerator or branch runs, the supplied scorer is validated on the base in a fresh worktree (spec 6.3, without author retries). Survivors are measured by the scorer's objectives and ranked (6.7 steps 2 to 4, 6.8, 7.2). The winner is applied to the workspace when it is safe to do so (6.9). A search can now end `applied` or `aborted: scorer invalid`.

**Blocked by:** 02 (Generation-0 search from a supplied scorer).

**Status:** ready-for-agent

- [ ] A gate declared `onBase: "fail"` that passes on the base, a gate whose two base runs disagree, and an objective that prints no finite number each end the search with `aborted: scorer invalid` before any enumerator runs, and the record holds the validation report.
- [ ] Survivors rank by the first objective in its declared direction, then by each next objective, then `diff_size`, then node key.
- [ ] Serial objectives run only after every other scoring command of the generation has finished, one branch at a time. With `repeat` set, the recorded value is the median.
- [ ] An objective that exits non-zero, times out, or prints no finite number kills that branch.
- [ ] Without an `onBase: "fail"` gate, a survivor that does not strictly beat the base value of the first objective cannot win; if none beats it, the outcome is `no survivor`.
- [ ] With `apply: "auto"` and an unchanged workspace, the winner's diff lands in the workspace, the outcome is `applied`, and the patch file stays in the state directory.
- [ ] A workspace that changed during the search, or `apply: "report"`, leaves every workspace file untouched, and the outcome is `ready`.
