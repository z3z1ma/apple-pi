## file

Knowledge and context_lint share reference extraction. contextReferences preserves the linter's fenced-block, heading, comma-separated Coupled/Verify and wiki-target handling. It returns references, not validated filesystem authority. The linter retains its existing finding messages and source-symbol validation; Workplace resolves targets and authorizes reads through its own workspace boundary.
Why: a separate graph parser would let the visual graph disagree with the references that the context linter checks.
Coupled: apps/agent-workplace/src/backend/knowledge.ts, components/wiki/src/graph.ts
Verify: components/code-context/tests/lint.test.ts, apps/agent-workplace/tests/knowledge.test.ts
