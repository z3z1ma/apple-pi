# 09: The pair asks the organization

**Context:** [spec.md](../spec.md) defines the terms used here (person, operator, runtime, thread, push and pull, ephemeral task, intern) and records the decisions this ticket implements.

**What to build:** The pair programmer gets `ask_for_second_opinion(question, to?)` and a read-only `directory`, replacing `ask_consultant` and the hidden consultant run. The mail goes in the main session's name, marked as from its pair, to `to` or the main session's manager. With no manager and no `to`, the tool refuses and says to name someone; the operator is reached only when named; with nobody to ask it says so. The main session is in the thread, so the reply is pushed to it and the pair sees it in the trajectory. The consultant agent, consultation context, managed-subagent service, and the pair's escalation and gate code are deleted.

**Blocked by:** 01 Mail is threads, 02 The directory and human-named manager tools

**Status:** done

- [x] From a hired person's pair, a second opinion reaches its manager in a thread with the main session, and the reply arrives in the main session.
- [x] Naming another person sends it to them instead.
- [x] From a session with no manager, a call without `to` is refused with the instruction to name someone, and the operator receives nothing.
- [x] The pair has no `ask_consultant`, and no consultant run happens (pair harness).

**Evidence:** Five new real-session integration cases exercise the private pair tools over a temporary runtime: manager routing and reply visibility (live trajectory and reseed), another named person, absent-manager refusal, blank-recipient refusal, and explicit operator routing. The focused Vitest run passed 199 tests in 20 files; the offline pair harness passed 112 checks, including failed-review and failed-notebook-commit staging. Typecheck (Node and web), format check, lint (one pre-existing notch-test warning), package loading, package dry run, and context lint passed. No live runtime or operator sessions were restarted.

**Deviations:** The hidden consultant, consultation context, gates, and fresh-run service path are deleted. The existing managed service's background path remains temporarily because the packaged opt-in Todos extension consumes it. Ticket 11 now explicitly migrates that consumer onto ticket 10's peer execution before removing the service. Historical findings and usage records keep their attribution; they start no consultant.
