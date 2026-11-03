## file

A lesson about an agent's own actions (a command, a tool-call pattern) belongs here as a rule, not in `.pi/LEARNINGS.md` prose; a matching prose line is retired when its rule lands. Code-pattern lessons belong in `lint/rules/` instead.

`commit-beside-edit` relies on Pi finishing the assistant message (`message_end`) before it runs that message's tool calls, so the batch is known when each `tool_call` arrives. The set is cleared at every assistant `message_end`, so only calls from the latest message count.
Why: parallel calls in one message run concurrently, so a `git add`/`git commit` beside an `edit` committed the old file content several times in this repository.

The rules block, rather than warn: a refused call returns its reason to the model, which then retries correctly.
Coupled: lint/README.md, .pi/LEARNINGS.md, components/notebook/src/distillation.ts
Verify: components/action-rules/tests/action-rules.test.ts
