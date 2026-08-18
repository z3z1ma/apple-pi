Status: active
Created: 2026-08-18
Updated: 2026-08-18

# Model context windows own price-tier policy; this package only respects them

## Context

Measured spend shows provider long-context price tiers are a large multiplier: 46% of
`gpt-5.6-sol` spend and 39% of `xai/grok-4.6` spend occurs on calls above each model's tier
cliff (see `.ledger/202608181322-account-sidecar-model-usage/task.md` and its research record).
The obvious but wrong reaction is to teach this repository where those cliffs are.

## Authority

Operator instruction, 2026-08-18, given directly in response to a proposal that named specific
models: do not hard-code Grok or codex model identifiers in TypeScript; Pi already supports
per-model context-window configuration, so set the window to the tier boundary in
configuration and make this package respect the configured window.

## Decision

1. Price-tier knowledge lives in Pi model configuration (`~/.pi/agent/models.json`), never in
   this repository's TypeScript. No provider or model identifier is introduced into package
   source for pricing purposes.
2. This package's compaction gating derives its threshold from the **effective configured
   context window** of the active model, and measures progress in **provider-reported context
   tokens**, so that lowering a model's `contextWindow` to its tier boundary actually bounds
   billed context.
3. Tuning a specific model's window is an operator configuration action recorded here, not a
   code change.

Pi already establishes this exact pattern upstream: direct OpenAI `gpt-5.6-sol`, `-terra`, and
`-luna` ship with a `272000` default window "so requests remain within OpenAI's short-context
pricing tier", and `modelOverrides` accepts `contextWindow` per model
(`node_modules/@earendil-works/pi-coding-agent/docs/models.md`, Per-model Overrides). Adopting
the same mechanism keeps one owner for the policy.

## Steelmanned alternatives

- **Encode cliffs in package source.** Rejected: it duplicates provider pricing metadata that
  Pi already models in `cost.tiers`, goes stale silently, and makes the package wrong for
  anyone on different pricing. It also puts a business fact in a code path that cannot be
  changed without a release.
- **Derive the cliff automatically from `cost.tiers[].inputTokensAbove`.** Genuinely appealing
  and strictly more accurate than a hand-set window, and it needs no model names. Rejected for
  now because it silently overrides an explicit operator `contextWindow`, and because a model
  may have several tiers or none. Recorded as a revisit condition rather than dismissed.
- **Route the advisor to a different provider than the main agent so the pools are separate.**
  Explicitly rejected by the operator on 2026-08-18: this is not to become a standing policy.
  Provider choice stays an operator decision per mode, not something the package assumes.

## Consequences

- The package gains a dependency on Pi exposing an effective context window and a
  provider-reported usage figure at gating time; both already exist
  (`ctx.model.contextWindow`, `ctx.getContextUsage()`).
- Operators who never configure a window keep working, so the gate must degrade to a defined
  behaviour rather than failing when the window or usage figure is unavailable.
- Configuration becomes load-bearing for cost. That belongs in user-facing documentation.
- Known current mis-configuration to fix separately in operator config, not in code: the
  operator's `~/.pi/agent/models.json` defines a custom `xai/grok-4.6` with
  `contextWindow: 272000` while that same entry declares `cost.tiers[0].inputTokensAbove:
  200000`, so the configured window sits above its own cliff.

## Revisit conditions

- Pi begins exposing a first-class "price tier boundary" or budget concept, making the manual
  window override redundant.
- Evidence shows operators routinely forget to set the window and would be better served by
  deriving the bound from `cost.tiers[].inputTokensAbove` with an explicit opt-out.
- A provider prices long context continuously rather than in tiers, making a single boundary
  the wrong model.
