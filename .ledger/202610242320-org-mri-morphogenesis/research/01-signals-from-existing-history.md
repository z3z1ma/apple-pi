# Signals computable from existing history

Read-only analysis of `~/.pi/agent/state/apple-pi.db` on 2026-10-24. Scripts: [01-signals.py](01-signals.py) and [01-signals-since-assignments.py](01-signals-since-assignments.py), run with `python3`. No transcript text was used: only table rows, event data, and tool names and path previews from the `messages` index.

**Scope of the data.** Events span 6.3 days; assignments exist for the last 2.2 days. 44 root people, 179 assignments (154 finished, 4 unassigned, 21 open), 666 mail threads, 178 task threads, 19 channels, 1,923 thread messages, $3,298 of model cost. A short window: every value below is a first look, not a baseline.

## Per signal

| Signal | Data it needs | Computable now? | Value on this machine | Missing fact |
| --- | --- | --- | --- | --- |
| Cost per task | `cost_changed` events joined to assignment windows | Partly | Over the whole span 79% of cost falls outside any assignment (sessions predate assignments). Since the first assignment: 40% falls in exactly one open assignment, 49% in several, 11% in none. 110 tasks: median $0.59, p90 $7.21, max $56.61. | **Focus history.** `work_focus` holds only the current focus. Focus changes can be rebuilt from `commands` of kind `work` (383 rows with time and action), so this is a projection, not a schema gap. |
| Decision fan-in | `thread_participants` (push) and `thread_messages` for managers and roots | Yes, as message load and reply latency | Two coordinators received 989 and 812 pushed messages; they replied in 297 and 368 cases, median about 1 min, p90 about 12 min. A third manager: 134 inbound, p90 1.5 min. | **Which messages need a decision.** Load is visible; decision demand is not. Reports, FYIs, and questions look the same. |
| Critical-path waiting | Run state while an assignment is open | Only a proxy | Awake people with open work were idle 135 h and working 114 h. | **Why a person is idle.** Waiting on a reply, a decision, a test, the operator, or just done but not finished: the data cannot tell them apart. No dependency between tasks is recorded. |
| Context rehydration | `incarnation_started` (generation > 1), `run_state` to `compacting`, then tool calls until the first `edit`/`write` | Yes, as a proxy | After a reopen (n = 25): median 15 reading calls before the first edit, p90 160. After a compaction (n = 87): median 6, p90 31. | **A comparison class.** Reading before editing is also normal new work. A meaningful measure needs the same person on the same task before and after, or similar tasks. |
| Duplicated investigation | `messages` rows for `read` with the path preview | Yes, as a proxy | 471 of 3,657 reads (13%) were of a file that another person had read in the previous 24 h; 178 files. | Intent: a shared hot file (AGENTS.md, a doc) is not rediscovery. Needs path classes or exclusion of always-read files. |
| Expertise locality (affinity) | `messages` tool calls with path previews, by person | Yes | Not computed as a score; the inputs are present for every `read`, `edit`, and `write`. | Nothing for files. For areas (a component, a domain), a mapping from paths to areas. |
| Verification debt | `bash` previews matching test and typecheck commands, against `edit`/`write` counts | Proxy only | 2,301 edits, 655 check runs; 13 people edited with no check run at all (many of them advise-only or doc-only people). | **Verification evidence linked to a task.** A test run is not tied to the change it verifies. |
| Operator attention | `ask_user_question` calls, operator thread participation, escalations, `seen` events | Yes | 141 questions, 4 threads with the operator, 0 operator messages in threads, 2 escalations, 865 `seen` events. | Time the operator spent (reading, answering) is not measured; `needs_you_since` gives waiting time on the operator. |

## What this says

- **Most signals are computable today as proxies.** The one structural gap is **why a person waits**: idle time with open work is larger than working time, and nothing distinguishes waiting on a decision from finished-but-not-reported. This bears directly on the new runtime facts question.
- **Cost attribution needs focus history, which can be derived** from the `work` commands. No new table is needed for that.
- **Coordinators carry the fan-in**, but replies are fast (median about a minute). On this data, a decision bottleneck at managers is not visible. That is weak evidence against hiring managers for fan-in at the current scale.
- **Rehydration after a reopen has a long tail** (p90 160 calls before the first edit). Even as a proxy, it is the strongest signal for "prefer the warm person" and for better checkpointing.
- Six days is too little history for trends. Any phase gate based on these values needs weeks of data.

## Verified and believed

Verified: the counts and values above, from the queries on this database. Believed, not checked: that the idle-with-open-work hours mostly reflect waiting rather than unreported completion; that cross-person rereads include real rediscovery and not only shared hot files.
