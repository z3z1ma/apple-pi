Status: active
Created: 2026-08-20
Updated: 2026-08-20

# Preserve Superpowers methodology in an apple-pi fusion

## Context

The preceding source study recommended a principles-only adaptation. The operator explicitly superseded that recommendation: Superpowers' language and ideal workflow are to be adopted almost wholesale, not reduced to a short list of principles. Every upstream instruction is presumed meaningful until a source-backed apple-pi translation preserves or enhances its operational effect. The necessary adaptations are apple-pi's Ledger, `Agent` subagent model, and `pi_exec` composition model.

## Decision

Build a single, Ledger-native apple-pi fusion of the complete Superpowers methodology at upstream commit `b36e0829c6d0140e93cfef2ca599b1b07d4a7797`.

The fusion must:

1. Trace every upstream workflow skill, supporting role prompt, and relevant procedure to a discoverable apple-pi owner. Do not omit or materially weaken an instruction merely because apple-pi already has an analogous primitive.
2. Preserve Superpowers' happy path—idea clarification and approval, scoped design, durable plan, disciplined execution, test-first behavioral work, root-cause debugging, independent review, fresh verification, and explicit finishing—while making Ledger the only durable task state.
3. Translate action vocabulary, not merely names: Superpowers subagent/controller workflows must use apple-pi's typed `Agent` sessions or `pi_exec` workers according to their ownership; parallelizable composition must use bounded `pi_exec`; implementation/review isolation and context boundaries must remain explicit.
4. Retain human authority for consequential decisions and external/destructive integration actions. Translate worktree, commit, branch, merge, push, PR, and cleanup instructions to apple-pi's existing authority and perimeter model; do not silently drop those workflow stages.
5. Use the upstream source as a close behavioral reference, but write a coherent current implementation rather than shipping a parallel Superpowers package or stale compatibility copy. Literal retained text must receive required MIT attribution in `THIRD_PARTY_NOTICES.md`.

## Authority And Provenance

- Operator instruction, 2026-08-20: “adopt Superpower's language almost wholesale,” preserve the weight of every word, adapt it to apple-pi's subagents and Pi Exec, and create a drastically superior merged workflow including the ideal happy path.
- Upstream source: `obra/superpowers` commit `b36e0829c6d0140e93cfef2ca599b1b07d4a7797`; MIT license, copyright Jesse Vincent.
- Current apple-pi ownership and exclusion evidence: `.ledger/202608202235-evaluate-superpowers-ledger-integration/research/superpowers-main-methodology.md`, `docs/boundaries.md`, `docs/ledger.md`, `docs/subagents.md`, and `docs/exec.md`.

## Alternatives Considered

### Principles-only adaptation

The prior recommendation proposed selectively adding a few portable rules to existing Ledger lifecycle skills. It minimized scope and preserved the current on-demand workflow, but it would discard the upstream's intentionally tuned language, complete happy path, role prompts, and workflow transitions. The operator rejected this as insufficient.

### Install Superpowers unchanged beside apple-pi

This would retain wording but create duplicate skill authority, state/workspace conventions, tool mappings, and agent roles. It would not teach Superpowers how to use Ledger, `Agent`, or `pi_exec`, and would produce an incoherent dual workflow. Rejected.

### Copy source text without behavior evaluation

Close textual copying alone risks false mapping of Superpowers' tool and harness assumptions to apple-pi. It neither proves the translated workflow fires nor preserves current safety/authority boundaries. Rejected; line-level traceability and fresh-context evaluation are required.

## Consequences

- The current stage-local-skill-only proposal is superseded. The work now includes a full methodology inventory, a canonical apple-pi bootstrap/entry point, complete happy-path design, role/prompt translation, lifecycle skill redesign or consolidation, artifact/state mapping, and empirical skill evaluation.
- Ledger remains the sole durable workbench. Upstream plan, progress, task brief, report, review package, ruling, and evidence concepts must be represented by existing Ledger records or a justified extension of its record contract—not a `.superpowers` directory or duplicate index.
- The implementation may add or replace skills and carefully scoped runtime integration if required to make the methodology active. It must not preserve old and new overlapping workflows as a hedge.
- The implementation task is necessarily larger than the preceding study. It must be decomposed into independently observable follow-up outcomes after full specification and plan evidence.

## Limits And Revisit Conditions

- The operator's requested source fidelity does not authorize contradiction of higher-priority safety constraints, invented tool mappings, unapproved external action, or literal copying without attribution.
- If exact source language conflicts with Ledger's single-state model or apple-pi's tool boundary, retain its intent and record the exact translation and rationale rather than silently deleting it.
- Revisit the owner boundaries only when a traceability record demonstrates that existing Ledger, `Agent`, or `pi_exec` semantics cannot preserve an upstream workflow requirement.

## Related Records

- `.ledger/202608202254-strengthen-ledger-workflow/task.md`
- `.ledger/202608202254-strengthen-ledger-workflow/specs/apple-pie-superpowers-fusion.md`
- `.ledger/202608202235-evaluate-superpowers-ledger-integration/research/superpowers-main-methodology.md`
