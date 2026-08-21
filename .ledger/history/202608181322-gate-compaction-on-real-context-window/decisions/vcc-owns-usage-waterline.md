Status: active
Created: 2026-08-18
Updated: 2026-08-18

# VCC owns the usage-vs-window compaction waterline

## Context

The measured cost defect is that billed context grew to a 196k median / 331k p90
because nothing compacted against provider-reported usage relative to the
configured `contextWindow`. Observational memory's `compaction-trigger.ts` was
the obvious place to "fix the gate", but VCC already implements that exact
waterline in `proactive-threshold.ts` (`getContextUsage().tokens` vs
`resolveTriggerTokens(threshold, ctx.model.contextWindow)`), with a 3s cooldown
and a `proactiveTriggerActive` loop guard. It was inert only because no
`globalThreshold` / `modelThresholds` was configured, so `getModelThreshold()`
returned undefined.

## Authority

Operator instruction 2026-08-18: bound billed context by the model's configured
window, with no provider or model identifiers in package TypeScript. Sibling
decision `context-window-is-the-price-boundary.md` places price-tier policy in
`models.json`. This decision names the runtime owner of the waterline.

## Decision

1. VCC is the single owner of "compact when billed context reaches a fraction of
   the configured window".
2. The package default is `compactPercent: 68` when the user's
   `pi-vcc-config.json` omits both `globalThreshold` and `defaultThreshold`.
   The default is applied at `loadSettings()` time and is **not** written into
   `DEFAULT_SETTINGS`, so `scaffoldSettings()` will not pin today's value into
   existing user files.
3. An explicit empty `globalThreshold` object (`{}`) is the opt-out: lookup
   returns it, `resolveTriggerTokens` cannot produce a trigger, VCC does not
   fire.
4. Observational memory's source-token gate remains as a late fallback only
   when VCC cannot evaluate a usage threshold this turn (no configured/default
   trigger, unknown window, or `getContextUsage()` unavailable). When VCC can
   evaluate, memory does not call `ctx.compact()`.

## Steelmanned alternatives

- **Rewrite memory's gate to a second absolute-usage waterline.** Rejected:
  two `ctx.compact()` owners on different hooks (`agent_end` vs
  `agent_settled`), one without a cooldown, and two copies of
  window→threshold resolution that can disagree. Law of One Reality.
- **Put `globalThreshold` in `DEFAULT_SETTINGS`.** Rejected: `scaffoldSettings()`
  writes missing default keys into the user's file, pinning the value so later
  default changes never reach existing installs.
- **Apply the default inside `getModelThreshold`.** Rejected: that function is
  a pure lookup over an already-loaded settings object; injecting policy there
  would change every explicit-settings test and hide the load-time contract.
  Opt-out via `{}` also becomes indistinguishable from "no threshold" if the
  lookup replaces empty objects.

## Consequences

- Existing installs that never set a VCC threshold begin compacting at 68% of
  the active model's configured `contextWindow` without a file edit.
- Installs that set `modelThresholds` for some models and omitted
  `globalThreshold` so every *unlisted* model would stay unthresholded now
  also get 68% on those unlisted models. Keeping per-model-only behaviour
  requires an explicit `"globalThreshold": {}`.
- Operators bound cost by lowering `models.json` / `modelOverrides`
  `contextWindow` to the price-tier boundary; they do not edit TypeScript.
- Operators who want the previous "VCC never auto-compacts on usage" behaviour
  set `"globalThreshold": {}`.
- `/om:status` must display the clock that will actually fire (VCC usage
  waterline when evaluable, otherwise the memory source-token fallback).

## Revisit conditions

- VCC is removed or stops owning proactive compaction.
- Evidence shows 68% is systematically too early or too late across the models
  the operator actually uses.
- Pi grows a first-class price-tier boundary that makes `compactPercent` of
  `contextWindow` the wrong lever.
