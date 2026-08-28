# Distill

`/distill [focus]` is an explicitly invoked prompt template for turning recent work into proposed durable knowledge and reusable harness artifacts. It runs as a normal model turn with the current conversation and available tools; there is no distillation extension, background service, or separate state store.

Distillation is broader than summarization. The model reviews the most recent meaningful work, uses Pair memory and transcript recall when needed, and looks for lessons worth carrying into future sessions. Ledger records, repository state, diffs, documentation, and existing artifacts are optional evidence rather than required inputs.

A pass can propose multiple destinations:

- `AGENTS.md` for strongly evidenced, broadly applicable instructions or boundaries that must remain in every agent context;
- `.wiki/` for durable project-local knowledge and sourced synthesis;
- a skill for a recurring model procedure;
- `.pi/programs/` for a demonstrated reusable `pi_exec` composition;
- authoritative documentation, tests, runbooks, code, or decisions when they are the real owner; or
- no artifact when a lesson is transient, duplicated, weakly supported, or not worth maintaining.

The command is proposal-first. Its initial turn inspects likely existing owners, explains each candidate and its evidence, recommends against low-value retention, and asks the operator what to approve. Invocation alone does not authorize writes. After approval, the model creates only the agreed artifacts using the relevant existing procedures and local conventions.

An optional focus narrows the inquiry without changing the behavior:

```text
/distill
/distill debugging and incident investigation
```
