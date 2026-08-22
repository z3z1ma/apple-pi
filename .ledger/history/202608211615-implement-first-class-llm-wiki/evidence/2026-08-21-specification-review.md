Status: recorded
Created: 2026-08-21
Updated: 2026-08-21

# LLM Wiki Specification Review

## Purpose

Assess whether the active LLM wiki specification is complete, internally consistent, ratified, minimal, and ready for implementation planning.

## Procedure

The prescribed typed Ledger specification gate was run twice against the specification, governing task, research, decisions, and repository architecture documentation. The first run failed because the reviewer emitted `null` for optional string fields; the second failed because it returned work-item verdict values in specification mode. Neither produced a valid gate result.

A fresh isolated read-only Counsel session then reviewed the same governing records for completeness, consistency, provenance, clarity, YAGNI, scope, and verifiability. After corrections, that reviewer performed two bounded verification passes over its findings. The persistent Advisor separately challenged redundant approval semantics for explicitly authorized query/file and lint/fix requests. The operator approved the resulting active specification on 2026-08-21.

## Observed Results

The fallback review identified and the specification corrected these observations:

- `OBS-LLM-WIKI-SPEC-FALLBACK-01` (critical): the concurrent Ledger artifact redesign changed task, plan, evidence, retrospective, and skill-authoring locations. The wiki task was blocked on that dependency and was normalized after the dependency reached `done`.
- `OBS-LLM-WIKI-SPEC-FALLBACK-02` (critical): baseline/treatment lacked a falsifiable promotion gate. The specification now requires matched controls, observable responses and filesystem effects, regression protection, and return to shaping when no material control failure exists.
- `OBS-LLM-WIKI-SPEC-FALLBACK-03` (significant): uppercase canonical names conflicted with existing-wiki preservation. The specification now distinguishes absent, compatible existing, and incompatible or case-equivalent paths.
- `OBS-LLM-WIKI-SPEC-FALLBACK-04` (significant): query/lint wording permitted incidental writes. Both are now strictly read-only phases followed by separately authorized mutation phases.
- `OBS-LLM-WIKI-SPEC-FALLBACK-05` (significant): the trust model lacked write containment and let local conventions expand authority. Local conventions are constrained, external symlinked vaults are rejected, and writes must resolve within `.wiki/`.
- `OBS-LLM-WIKI-SPEC-FALLBACK-06` (significant): unretained ephemeral sources could yield unintelligible provenance. Unretained sources now require useful identity, explicit nonrecoverability, and enough quotation or context.
- `OBS-LLM-WIKI-SPEC-FALLBACK-07` (significant): mandatory index/log edits could create artificial churn. `INDEX.md` changes only when navigation changes; `LOG.md` records only completed mutations.
- `OBS-LLM-WIKI-SPEC-FALLBACK-08` (significant): supporting-artifact wording allowed files without a production consumer. V1 defaults to one `SKILL.md`; support requires both an observed need and explicit production consumption.
- Follow-up verification clarified per-workflow prerequisites and degraded behavior and rejected an externally resolving `.wiki` root.
- Advisor reconciliation established that an explicit initial `query and file` or `lint and fix` request authorizes the post-answer/report mutation phase; a second confirmation is required only when the resulting scope materially expands.

The two fallback verification passes found all observations addressed and no new material blocker. The dependency task was subsequently observed under `.ledger/history/` with `Status: done`.

## Limits

- The prescribed typed specification gate never completed successfully, so no typed-gate approval is claimed.
- The fallback review was independent and read-only but remained a model assessment rather than runtime evidence.
- Specification approval does not prove that fresh-context skill treatment will improve behavior; the active plan must gather that evidence before packaging guidance is accepted.
- Prose guidance cannot guarantee atomic multi-file writes. Symlink containment, optional source retention, semantic lint quality, and large-vault retrieval remain execution-time risks to evaluate within the specified bounds.
