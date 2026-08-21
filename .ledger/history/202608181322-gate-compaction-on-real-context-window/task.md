Status: cancelled
Created: 2026-08-18
Updated: 2026-08-18

# Gate compaction on real context usage within the configured window

## Scope

The proactive compaction gate fires on estimated **source-entry** tokens since the last
compaction (default 81k) and ignores the active model's configured `contextWindow` entirely. The
provider bills a different quantity: measured billed context reached 196k median and 331k p90 in
the heaviest session, crossing provider long-context price tiers that carried 39-46% of spend on
the affected models.

This task makes compaction request when billed context reaches a fraction of the model's
effective configured `contextWindow`, so that an operator lowering a model's `contextWindow` to
its price-tier boundary actually bounds billed context. No provider or model identifier enters
package source; tier policy stays in Pi model configuration. VCC is the runtime owner of that
waterline; observational memory keeps its source-token gate only as a fallback.

## Non-goals

- Changing VCC's compaction cut selection or summary content. This task changes *when*
  compaction is requested, not what compaction does.
- Changing the advisor's own context budget. That is owned by
  `.ledger/202608181322-design-advisor-context-framing/task.md`.
- Deriving price-tier boundaries automatically from `cost.tiers[].inputTokensAbove`. Considered
  and deliberately deferred in `decisions/context-window-is-the-price-boundary.md`.
- Adding spend caps, budgets, or throttling.
- Rewriting observational memory's source-token clock or flipping
  `compactAfterTokensMode`. Those remain the fallback, not the waterline.

## Acceptance Criteria

- AC-001: With a model whose effective `contextWindow` is W, compaction is requested when
  context usage *anchored on provider-reported usage* reaches the configured fraction of W.
  `ctx.getContextUsage()` returns last-assistant usage plus an estimate for trailing messages,
  so the gate is provider-anchored rather than purely provider-reported; the residual estimate
  covers only messages after the last completed assistant turn.
- AC-002: Lowering a model's configured `contextWindow` observably lowers the billed context at
  which compaction fires, demonstrated by measured per-call context in a real session rather
  than by unit test alone.
- AC-003: Failure boundary — when provider-reported usage is unavailable (no usage yet, stale
  extension context, post-compaction baseline missing), the gate falls back to a defined,
  documented behaviour and never silently stops compacting.
- AC-004: Failure boundary — when the model's context window is unavailable, the gate still has
  defined behaviour and does not divide by an absent value.
- AC-005: No provider name, model identifier, or price-tier constant is introduced into package
  TypeScript for pricing purposes.
- AC-006: `docs/context.md` states how the threshold is derived and that configuring a model's
  context window is the supported way to bound cost.

## Work Items

- [x] WI-001: Enable VCC's existing usage-vs-window waterline as the package default
      (`compactPercent: 68` at `loadSettings()` time, not written into user files) and make
      observational memory defer `ctx.compact()` when that waterline can evaluate.
- [x] WI-002: Record the owner and default-timing decision, including the
      per-model-only-threshold user class, in `decisions/vcc-owns-usage-waterline.md`.
- [x] WI-003: Memory's deferred re-check uses the same `hostOwnsUsageThreshold` predicate as
      the initial check.
- [x] WI-004: Tests for default trigger scaling, missing-usage, missing-window, opt-out,
      unlisted-model fallback, and memory deference.
- [x] WI-005: `docs/context.md` states how the threshold is derived and that `models.json`
      `contextWindow` is the supported cost lever.

## References

- `.ledger/202608181322-account-sidecar-model-usage/task.md` — measured baseline
- `decisions/context-window-is-the-price-boundary.md`
- `decisions/vcc-owns-usage-waterline.md`
- `components/vcc/src/hooks/proactive-threshold.ts` — the usage waterline
- `components/vcc/src/core/settings.ts` — load-time default and `hasEvaluableUsageThreshold`
- `components/memory/src/hooks/compaction-trigger.ts` — fallback source-token gate
- `docs/context.md` — user-facing contract
- `node_modules/@earendil-works/pi-coding-agent/docs/models.md` — `modelOverrides.contextWindow`

## Assumptions

- `ctx.model.contextWindow` at gate time reflects `models.json` overrides and custom model
  entries rather than only built-in metadata. **Verified** 2026-08-18:
  `node_modules/@earendil-works/pi-coding-agent/dist/core/provider-composer.js:290-301`.
- `ctx.getContextUsage()` is available on VCC's `agent_end` path. **Verified** 2026-08-18:
  general `ctx` method; last-assistant usage is present after the turn completes
  (`docs/extensions.md:1039-1048`).

## Journal

- 2026-08-18: Created. Root cause identified as a unit mismatch rather than a mis-tuned
  threshold.
- 2026-08-18: Implementation changed owners. VCC already gated `getContextUsage().tokens`
  against `ctx.model.contextWindow`; it was inert because no threshold was configured. Enabled
  that owner with a live `compactPercent: 68` default and made memory defer when VCC can
  evaluate.

## Blockers

AC-002 remains open: needs measured per-call context from a session run after this change.
Everything else that this run can evidence is in Evidence.

## Evidence

- AC-001: `Done` in unit tests. Default `compactPercent: 68` on a 200k window triggers at
  136,001 tokens. `bun test components/vcc/tests` 465 pass; targeted vitest 59 pass;
  `npm run typecheck` passed.
- AC-002: `Not verified`. Threshold halves when the configured window halves (200k → 136k,
  100k → 68k) in `settings-load.test.ts`. No post-change session was driven to measure billed
  context at the new fire point.
- AC-003: `Done` in unit tests. `hasEvaluableUsageThreshold` is false when usage tokens are
  unavailable, so memory keeps the source-token fallback. VCC no-ops on `tokens: null`.
- AC-004: `Done` in unit tests. `contextWindow: 0` produces no VCC trigger; memory fallback
  remains.
- AC-005: `Done` by inspection. No provider or model identifier added to package TypeScript.
- AC-006: `Done`. `docs/context.md` "When compaction fires" documents the 68% default, the
  `contextWindow` lever, overrides, and the empty-`globalThreshold` opt-out.

## Review

Pending.

## Retrospective

Pending.

## Distillation

Pending.
