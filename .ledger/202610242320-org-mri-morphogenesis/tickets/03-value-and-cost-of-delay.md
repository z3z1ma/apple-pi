# 03: Value and cost of delay on tasks

Part of the approved spec [../spec.md](../spec.md); its Terms table defines obligation, completion, window, horizon, and the other words used here.

**What to build:** Whoever creates or adds work can give it a value and a cost of delay in dollars. `take_task`, `assign`, `call_in`, and `rehire` with a goal, and `hire` (its goal reaches the task through the start command), accept an optional value and cost of delay and write them as `Value: $50` and `Cost of delay: $5/hour` header lines in the new `task.md`, beside `Status:`, marked as the writer's estimate: `Value: $50 (estimated by Name)`; a value without the mark is unattributed, not confirmed. Assigning an existing task leaves its file as it is. One shared reader returns a task's value and cost of delay from its `task.md`: a task is unvalued when its `Value:` line is missing or unreadable; a readable value without a readable cost of delay has a cost of delay of 0; cost of delay is read per hour, and `/day` is converted; the reader also says whether the value is marked as an agent's estimate or unattributed.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Through a faux session, `assign` with a goal, a value of 50, and a cost of delay of 5 writes a `task.md` whose header holds `Value: $50` and `Cost of delay: $5/hour`; without them, the header holds neither line.
- [ ] `take_task`, `call_in` and `rehire` with a goal, and `hire` write the same lines when given values.
- [ ] The reader returns 50 and 5 for those lines; unvalued for a file without `Value:` and for `Value: fifty`; 0 (valued) for `Value: $0`; and value 50 with cost of delay 0 when only `Value: $50` is present.
- [ ] An operator edit of the `Value:` line is what the reader returns next; nothing caches it.
