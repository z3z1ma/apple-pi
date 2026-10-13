# Distill

`/distill [focus]` is an explicitly invoked prompt template that promotes learnings from machine-owned project files into human-owned ones. It runs as a normal model turn with the current conversation and available tools; there is no distillation extension, background service, or separate state store.

The harness already places session learnings without asking in machine-owned files: `.pi/LEARNINGS.md`, `.wiki/`, ledger task retrospectives, and `.pi/programs/` (see [Context and notebook](context.md#pair-programmer-notebook)). A distill pass:

- places any open notebook learnings the same way;
- keeps `.pi/LEARNINGS.md` lean: merges duplicates, removes stale or promoted lines, and moves long explanations to the wiki, without asking;
- proposes promotions to human-owned files: the project `AGENTS.md`, a skill, or authoritative docs, tests, runbooks, or code; and
- after the user approves, writes only the approved changes and removes each promoted line from `.pi/LEARNINGS.md`.

Project files are the default scope. User-level files such as `~/.pi/agent/AGENTS.md` are proposed only when the user asks. Credentials, private transcript text, and notebook records stay in session storage; durable files receive only non-sensitive synthesis.

An optional focus narrows the inquiry without changing the behavior:

```text
/distill
/distill debugging and incident investigation
```
