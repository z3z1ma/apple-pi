## file

This repository-local guard is scoped to the shared conversation transcript. Live response timestamps come from first receipt, while saved timestamps come from persistence; they need not be monotonic. The current continuation predicate conjoins nonnegative ordering and the strict five-minute upper bound.

The query recognizes the current signed-subtraction form, looks for the matching ordering comparison, and rejects any OR in that condition. It is a bounded syntax guard, not a proof of boolean implication: a legitimate equivalent predicate or an unrelated safe OR can require updating the rule and its samples together. The built-reader clock/grouping tests own observable behavior.
Why: an upper bound alone accepts negative gaps, but requiring one spelling of the safeguard must stay distinct from the product contract.
Coupled: .pi/rules/policy.json, apps/agent-workplace/web/overlay/conversation/transcript.tsx
Verify: lint/repo-rules.mjs, apps/agent-workplace/tests/world-conversation.test.ts
