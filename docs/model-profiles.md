# Model profiles

Model profiles are the user-owned inference policy for apple-pi. Interns, the pair programmer, and branch search select semantic workload names; the profile file maps those names to a provider model and thinking level.

The only authority is the user-global file:

```text
~/.pi/agent/model-profiles.json
```

`$PI_CODING_AGENT_DIR` replaces `~/.pi/agent` when set. Project files are never read, even for trusted projects.

```json
{
  "profiles": {
    "quick": {
      "model": "openai-codex/gpt-5.6-luna",
      "thinking": "medium"
    },
    "balanced": {
      "model": "openai-codex/gpt-5.6-luna",
      "thinking": "high"
    },
    "pair": {
      "model": "provider/economical-supervision-model",
      "thinking": "medium"
    },
    "deep": {
      "model": "anthropic/claude-opus-5",
      "thinking": "xhigh"
    },
    "coding": {
      "model": "xai/grok-4.6",
      "thinking": "high"
    },
    "visual-engineering": {
      "model": "github-copilot/gemini-3.7-flash",
      "thinking": "medium"
    },
    "background": {
      "model": "openai-codex/gpt-5.6-luna",
      "thinking": "low"
    }
  }
}
```

Each profile requires exactly:

- `model`: an exact `provider/model` identity known to Pi's model registry;
- `thinking`: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.

Profile names are exact, case-sensitive, and limited to the seven known names below. The global file maps those names to provider models and thinking levels; it cannot introduce new profile names. Unknown fields and partial bundles are invalid. A missing mapping or unavailable selected model fails visibly; apple-pi does not substitute another profile, model, or older configuration format.

The inference profiles have these intended inference characteristics:

| Inference profile | Intended characteristics |
| --- | --- |
| `quick` | Fast, economical model with light-to-moderate reasoning. |
| `balanced` | Broadly capable model with measured reasoning. |
| `pair` | Economical, attentive model that follows the work and notices concrete risk. |
| `deep` | Strongest available model with high reasoning effort. |
| `coding` | Code-strong model with high reasoning effort. |
| `visual-engineering` | Model strong in UI, spatial, and multimodal reasoning, with moderate-to-high effort. |
| `background` | Low-cost model with low reasoning effort for asynchronous work. |

The intern tools (`explore`, `research`) use `quick`. The persistent pair programming partner always uses `pair`. Branch search's optional judge uses the profile its configuration names. People in the organization, including the peers of `pi_exec` programs, do not use profiles: their catalog roles name their minds directly ([organization](organization.md#the-person)). The other names are valid in the file but have no built-in user.

Profiles select only model and thinking. They never grant tools, write access, extensions, skills, pair programmer use, persistence, or any other capability.

To switch providers, replace or rename the global file. No repository changes or runtime migration layer are involved.
