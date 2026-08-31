Status: complete
Created: 2026-08-30
Updated: 2026-08-30

# Retrospective

## What Mattered

The default root surface dropped from 25 to 15 custom tools and from about 64.8k to 43.3k characters of tool metadata. The largest reduction came from removing the duplicate Pi Exec guest contract while preserving its complete `code`-parameter documentation. Ambient workflow, backlog, and to-do guidance was replaced by a concise ledger contract and explicit one-shot reminders; the full backlog and to-do implementations remain packaged as optional extensions.

## Learnings

- Attention audits must count both tool schemas and recurring prompt blocks; moving code without removing default registration does not simplify the model surface.
- A reminder batch belongs at `agent_settled`, not `turn_end`, because one agent run can contain several assistant/tool rounds.
- A guest API rename must update the worker global, host dispatch, budget detection, saved programs, docs, and tests as one contract.
- Broad terminology replacement is unsafe around identifiers and sentence boundaries. Compiler checks, focused searches, and independent review caught damage that ordinary replacement missed.
- Extension bridge changes require a clean Pi reload for interactive validation; a running process can combine an old host module with a newly read worker file.

## Improvements

For future harness-surface changes, inventory first, change one exposure boundary at a time, add a focused regression for each renamed or removed contract, and reload before interpreting live extension behavior. Use an isolated verification snapshot when unrelated concurrent work temporarily breaks the shared tree.
