## file

Drive the command client through a real isolated Unix socket, supplying receipt stages independently from terminal completion. After a delivered retry snapshot, drain the scheduled acceptance timer before completing the command; assert that both callers still receive the eventual outcome and progress. Equal attempts may share a transmission or rely on runtime deduplication; the behavior under test is that no waiting caller is stranded. A changed request under the same live ID must be refused without replacing the original caller.
Why: a fixed elapsed-time advance can become a false positive if the timeout changes, and counting transmissions would constrain coalescing rather than the required caller-visible outcome. A receipt is evidence of acceptance, not completion.
Coupled: apps/agent-world/src/backend/commands.ts
Verify: apps/agent-world/tests/commands-client.test.ts, apps/agent-world/tests/instruct.test.ts
