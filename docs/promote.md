# Promote

`/promote [focus]` is an explicitly invoked prompt template that proposes moving learnings from machine-owned project files into human-owned ones. It runs as a normal model turn with the current conversation and available tools; there is no promotion extension, background service, or separate state store.

[Distillation](context.md#pair-programmer-notebook) keeps durable learnings in machine-owned files: `.pi/LEARNINGS.md`, `.wiki/`, ledger task retrospectives, and `.pi/programs/`. A promotion pass reads them and proposes changes to the project `AGENTS.md`, a skill, or authoritative docs, tests, runbooks, or code. It writes only what the user approves, then removes each promoted line from `.pi/LEARNINGS.md`.

Project files are the default scope. User-level files such as `~/.pi/agent/AGENTS.md` are proposed only when the user asks. Credentials, private transcript text, and notebook records stay in session storage; durable files receive only non-sensitive synthesis.

Promotion is optional. A repository owner who wants machine-maintained learnings shared can instead track `.pi/LEARNINGS.md` in git.

An optional focus narrows the inquiry without changing the behavior:

```text
/promote
/promote debugging and incident investigation
```
