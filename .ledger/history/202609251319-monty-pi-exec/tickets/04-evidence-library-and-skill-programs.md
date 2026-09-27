# 04: Evidence library in Python, and the review and Ralph programs rewritten

**What to build:** The deliberately small evidence library is available to Python as host functions: git change and patch, change-neighborhood evidence, the required/clippable/droppable context marks with fit and pack, strict schema shorthand if 02 did not cover it, and relevant-test discovery and bounded execution. The coverage and reconcile helpers are removed, because Python sets and dicts express them directly. Marked contexts passed to `agent_run` are fitted automatically, as today. The code-review and Ralph reference programs are rewritten in Python against the live signatures, and their skill instructions describe the Python programs. The exec documentation's library section is updated.

**Blocked by:** 02: Model workers from Python.

**Status:** done

- [x] `git_change` on a dirty checkout returns the changed paths, the patch, and line totals that match `git diff`.
- [x] A marked `agent_run` context that is larger than the channel budget is fitted, and `context.truncated` lists the clipped paths.
- [x] `dev_run_relevant_tests` with no discovered tests returns `not_run` with a reason.
- [x] Every rewritten code-review and Ralph reference program passes the type check against the live signatures.
- [x] A multi-lens review run on a small real diff returns findings with evidence.
- [x] The guest contract has no coverage or reconcile function.
