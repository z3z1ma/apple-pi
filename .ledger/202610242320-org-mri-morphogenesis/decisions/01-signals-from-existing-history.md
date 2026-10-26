Type: research
Status: resolved
Blocked by: 

## Question

Which MRI signals from `source.md` can be computed today from the existing session-state database and transcripts, and how trustworthy is each? For each signal (critical-path waiting, decision fan-in, context rehydration, coordination amplification, duplicated investigation, expertise locality/affinity, verification debt, operator attention, cost per task), say: the tables and events it needs, whether it is computable now, a real value from this machine's history, and what fact is missing. Read-only on `~/.pi/agent/state/apple-pi.db` and transcripts; keep no transcript text in the findings.

## Answer

Most signals are computable today as proxies (cost per task, manager message load and reply latency, rehydration calls after reopen or compaction, cross-person rereads, affinity, check runs against edits, operator questions). Cost attribution needs focus history, which can be rebuilt from `work` commands without a schema change. The one structural gap is why a person waits: awake people with open work were idle 135 h against 114 h working, and nothing tells waiting on a decision from finished-but-unreported. Coordinators carry the fan-in (989 and 812 pushed messages) but reply in about a minute, so no manager decision bottleneck shows at this scale. Six days of events is too short for trends. Findings: [research/01-signals-from-existing-history.md](../research/01-signals-from-existing-history.md).
