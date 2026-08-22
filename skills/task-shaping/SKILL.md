---
name: task-shaping
description: "Use when the operator asks to explore or design an unclear outcome, consequential product choices remain unresolved, or a large body of work needs collaborative decomposition before implementation."
---

# Shape Work Collaboratively

Use conversation to resolve choices that materially affect behavior, architecture, cost, safety, or irreversible side effects. Clear implementation requests take the direct path.

## Direct execution wins

When the operator says what they want and the request is bounded enough to implement safely, begin work. Their instruction approves that scope; artifacts arise only from a concrete continuity or coordination need.

Ask only when a missing answer would materially change the result or authorize a consequential action. Choose reversible implementation details yourself.

## Choose the lightest path

### Direct

Use for clear, reversible work that the root session can complete coherently.

1. Inspect the immediate owner and nearby conventions.
2. Implement the smallest useful version.
3. Run a targeted check.
4. Report and let the operator react to the artifact.

No Ledger, design artifact, subagent, or independent review is required.

### Collaborative

Use when the operator asks to work the idea out or two plausible choices produce meaningfully different outcomes.

1. Establish the goal and decisive constraints from existing context.
2. Ask the smallest number of questions needed; group related choices when useful.
3. Recommend one simple approach and explain the consequential trade-off.
4. Once the operator chooses, implement unless they asked for a durable design first.

A few sentences in chat and one decision point are usually enough.

### Durable design

Use a Ledger task and optional specification only when the work needs cold-start continuity, coordinates substantial independent outcomes, changes a costly architecture or public contract, or will likely span sessions. Record only decisions that a future executor cannot safely recover from the repository and operator request.

A specification is justified when behavior, invariants, failure semantics, or migration boundaries must remain stable independently of implementation. A plan is justified when sequencing and ownership materially reduce execution risk. Neither artifact is an automatic next step.

## Progressive development

Prefer a working vertical increment over speculative completeness:

- start with the smallest coherent behavior;
- show the operator real output early;
- incorporate feedback directly;
- add abstractions, tests, documentation, and operational machinery when the next real need appears;
- keep verification and planning smaller than the change they support.

If implementation reveals hidden consequential ambiguity, pause at that boundary, explain the specific choice, ask once, and resume from there.

## Research and decisions

Research facts only when they can change the next decision. Read official/version-specific sources for unfamiliar APIs and capture durable research only when another session will need its provenance or limits.

Record a decision only when it is costly to reverse or future maintainers would otherwise reopen it. Operator statements already supply authority.

## Review

Self-check a design for contradiction, excess scope, and missing failure behavior. Independent design/spec review is optional and reserved for genuinely costly or hard-to-observe failures. One well-scoped review supplies the findings; the root validates them and makes ordinary corrections directly.

## Visual companion

Offer the visual companion when an actual visual choice is materially easier to decide by seeing it. If accepted, follow [visual-companion.md](visual-companion.md).

## Stop conditions

Stop and ask only for:

- irreversible or destructive actions;
- external publication, deployment, or material cost without authority;
- unresolved security-sensitive choices that change trust, permissions, credentials, or exposure;
- unresolved product meaning that changes observable behavior;
- scope materially beyond what the operator requested.

Everything else should move forward.
