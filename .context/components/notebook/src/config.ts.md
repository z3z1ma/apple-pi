## file

Notebook source limits bound the evidence sent to notebook maintenance; they are separate from the main conversation's compaction settings. Pi's `compaction` settings own summary timing and retained conversation history, including in the private pair session.
Why: removing the former notebook compaction trigger also removed its `pair.compact*` settings, but the similarly named notebook source budget is still required by the maintenance consumer. Reusing that budget as a compaction threshold would restore the removed competing policy.
Coupled: components/notebook/src/notebook-maintenance.ts, components/pair-programmer/src/session.ts, docs/context.md
Verify: components/notebook/tests/config.test.ts, components/notebook/tests/notebook-source-cap.test.ts
