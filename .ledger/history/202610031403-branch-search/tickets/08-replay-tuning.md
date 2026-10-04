# 08: Replay and tuning report

**What to build:** An operator can replay a grid of configurations over the stored search records of a repository and get the tuning table of spec 18.1. Replay uses the same planning and selection functions as the online search, so replaying a record's own configuration reproduces it.

**Blocked by:** 07 (Later generations: new roots and children of dead branches).

**Status:** ready-for-agent

- [ ] Replaying each stored record's own configuration reproduces its planning steps and outcome (A8).
- [ ] A configuration that needs a node or enumeration missing from a record is reported unevaluable on that record.
- [ ] Given value lists for the tunable keys, the report lists per configuration its unevaluable records and, on the records where all configurations are evaluable, solved count, tokens, and wall-clock, ranked as spec 18.1 states, with the current configuration winning ties.
- [ ] Records of `draw: "model"` searches replay only under `draw: "model"`.
- [ ] The docs page describes how to run replay tuning.
