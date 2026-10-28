# Model profiles

Model profiles are user-owned inference policy: a workload name maps to one model or a pool of models the operator considers suitable for that workload. Roles define jobs and authority; profiles select model and thinking. Profiles grant no tools, write access, extensions, skills, or persistence.

The only configuration authority is:

```text
~/.pi/agent/model-profiles.json
```

`$PI_CODING_AGENT_DIR` replaces `~/.pi/agent` when set. Project files are never read, even for trusted projects.

## Configure a profile

Each pool entry pairs an exact `provider/model` known to Pi with its own thinking level. Equivalent effort can require different settings across models.

```json
{
  "profiles": {
    "coordination": {
      "selection": "round-robin",
      "models": [
        { "model": "openai/gpt-6.1-sol", "thinking": "high" },
        { "model": "xai/grok-4.7", "thinking": "high" }
      ]
    },
    "writing": {
      "selection": "ordered",
      "models": [
        { "model": "openai/gpt-6.1-terra", "thinking": "xhigh" },
        { "model": "antigravity/gemini-3.8-flash", "thinking": "high" }
      ]
    }
  }
}
```

The single-model shorthand remains valid:

```json
{ "profiles": { "quick": { "model": "openai/gpt-6-luna", "thinking": "xhigh" } } }
```

A pool requires `selection` and a non-empty `models` array. Each entry requires exactly `model` and `thinking`. Thinking is `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; select levels supported by the particular model. Pi applies its native level clamping; roles record the effective level. Unknown fields, mixed shorthand/pool fields, malformed entries, and unknown profile names fail visibly. A file can define only the profiles it uses.

## Selection

| Mode | Behavior |
| --- | --- |
| `ordered` | Select the first eligible entry. |
| `random` | Sample uniformly from eligible entries on each selection. |
| `round-robin` | Rotate through eligible entries across processes sharing the same agent directory. |

Eligibility requires a registered model and configured authentication when the registry exposes that check. It does not prove remaining quota, endpoint health, or successful inference. A configured pool with no eligible entries fails visibly. Selection does not retry provider requests, track token usage, or switch models when a provider rejects a request.

Round-robin stores one transactional counter per profile in `~/.pi/agent/state/model-profile-selection.sqlite`, separate from the workplace database. It creates no daemon and never edits the profile file. Ordered and random selection need no counter state. Deleting this file resets rotation. Counters continue across policy edits; the next value is applied to the current eligible pool. Rotation balances selections, not spend, tokens, or active work. Pool entries are the unit of selection: two entries from one provider give it two slots.

For a role, selection happens once and the actual model and thinking are recorded in the person's transcript. Resume reapplies that saved mind rather than sampling again. Forks inherit the saved mind with the copied transcript. A pre-existing role record without a saved mind selects and records one at its next start. Other profile consumers select when they resolve a profile: an intern invocation, pair initialization, or judge request. They do not rotate per conversation turn.

## Profile names

Names are exact, case-sensitive, and limited to this catalog:

| Profile | Intended workload | Packaged role users |
| --- | --- | --- |
| `quick` | Fast, economical reading with enough reasoning for exploration and research. | Interns, rather than a packaged role. |
| `balanced` | General engineering analysis at measured effort. | Engineering reviewers and general advisers. |
| `pair` | Attentive, economical supervision of the main session. | Pair programmer, rather than a packaged role. |
| `deep` | Strongest available judgment for difficult or high-stakes questions. | Architects, security, scientific and product challengers. |
| `coding` | Code implementation with strong tool use. | Implementation Engineer. |
| `visual-engineering` | Visual and spatial analysis or implementation at measured effort. | Principal UX Researcher. |
| `background` | Low-cost asynchronous work. | No built-in role user. |
| `coordination` | Strong judgment for sustained planning, delegation, and decisions. | Coordinator, Director of Engineering. |
| `routine` | Economical inference for bounded reading, execution, and reporting. | Repository Archaeologist, Test and CI Operator, Skeptical First-Time User. |
| `writing` | Clear technical prose from a capable writing model. | Technical Writer. |

A profile is an operator's equivalence judgment, not a benchmark guarantee. Raising thinking does not automatically make a smaller model equal to a stronger one. Keep strongest-judgment pools narrow when that equivalence has not been established. Neither rotation nor random selection guarantees different providers for all members of a review board.

## Roles and defaults

A role's `models` list can begin with a profile name, followed by ordered concrete recommendations:

```yaml
models: [writing, openai/gpt-6.1-terra, anthropic/claude-sonnet-5-5]
thinking: xhigh
```

When `writing` is defined, its selected entry supplies both model and thinking. When the global file or that mapping is absent, the role uses its concrete recommendations and its frontmatter thinking level. A profile can appear only first, and a profile-first role keeps at least one concrete recommendation. Concrete-only custom roles also work.

A malformed configured file or an unusable configured pool is an error, not permission to bypass the operator's policy. Roles block work when configured policy or a saved mind cannot be applied. Concrete recommendation lists retain their warning-and-default behavior if none can be selected. See [organization](organization.md#the-person) for identity and resume behavior.

Role defaults therefore work without the global file. Interns (`quick`), the pair (`pair`), and branch search's optional profile judge still require their configured mappings; this is not a package-wide zero-configuration change. Intern processes disable extension discovery and load only their explicit safety and reading extensions, so `quick` must use models available without provider extensions. A provider registered only by a root extension, such as Antigravity, can serve root people or the pair but is not available in the intern child.

## Starting policies

The repository examples follow the operator's rough sizing guide, not measured benchmark scores:

| Workload band | Model and thinking equivalence used for policy | Profiles |
| --- | --- | --- |
| Frontier judgment | Astra medium or higher; Fable medium or higher; Opus high or higher. | `deep` |
| Strong engineering | Sol high; Opus medium; Grok high. | `balanced`, `coding`, `coordination` |
| Capable writing and visual work | Terra xhigh; Sonnet high; Gemini high; Grok medium. | `writing`, `visual-engineering` |
| Economical support | Luna xhigh; Haiku high; Gemini medium; Grok low. | `quick`, `pair`, `routine`, `background` |

Thinking labels are model-relative: Luna/xhigh is economical support under this policy, not frontier judgment. A role's obligation and a model's writing or visual affinity still matter within a band. These bands guide the shipped policy; custom global pools remain the operator's judgment, without runtime intelligence scores or automatic tier enforcement.

Concrete role recommendations share one frontmatter thinking level. They meet at least their profile's workload band; later defaults can be stronger or use more effort than the minimum. For example, a strong-engineering role at high effort can recommend Sol, Grok, then Opus; Opus/high is a stronger fallback than the profile's Opus/medium. Routine defaults use Luna/xhigh then Haiku/xhigh, while a configured pool uses the more efficient Haiku/high equivalent. Writing defaults prefer Terra/xhigh then Sonnet/xhigh; the Anthropic profile uses Sonnet/high. Profile entries are the way to express exact per-model equivalence without changing the concrete-list format.

The repository root carries `model-profiles.openai.json` and `model-profiles.anthropic.json`, copied by [setup](setup.md#4-configure-model-profiles). Both cover all ten names. The OpenAI example uses ordered single-entry pools: Astra/high for deep judgment, Sol/high for engineering and coordination, Terra/xhigh for writing and visual work, and Luna/xhigh for support. The Anthropic example uses Opus/medium for engineering and coordination, Sonnet/high for writing and visual work, and Haiku/high for support. Its deep pool rotates Opus/high and Fable/medium, following the guide while retaining different model perspectives.

Expand a pool and choose round-robin or random when you want to spread assignments. Mix providers within any pool; a provider-specific example is a starting policy, not a restriction.

To switch providers, edit or replace the global file. Existing people retain their saved minds; new people and other future profile resolutions use the new policy.
