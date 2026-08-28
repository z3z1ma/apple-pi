# Model profiles

Model profiles are the user-owned inference policy for apple-pi. Agent types and sidecars select semantic workload names; the profile file maps those names to a provider model and thinking level.

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
| `quick` | Latency-first inference intended for a fast, economical model with light-to-moderate reasoning effort. |
| `balanced` | General-purpose inference intended for a broadly capable model with substantial but measured reasoning effort. |
| `pair` | Economical persistent supervision intended to watch trajectories and route rare deep consultations. |
| `deep` | Maximum-depth inference intended for the strongest reasoning model available with high reasoning effort. |
| `coding` | Software-engineering inference intended for a code-strong model with high reasoning effort. |
| `visual-engineering` | Visual-engineering inference intended for a model strong in UI, spatial, and multimodal reasoning with moderate-to-high effort. |
| `background` | Low-cost asynchronous inference intended for an economical model with low reasoning effort. |

Built-in and custom Markdown agents may select one of these known names with `profile:`. The interactive `Agent` tool and `pi_exec` workers may override a type's default with the same `profile` enum. A generic `agents.run` worker may select a profile without selecting a type; without either, it inherits the parent session's model and thinking. The persistent Pair always uses `pair`; the episodic Advisor sub-agent uses `deep`.

Profiles select only model and thinking. They never grant tools, write access, extensions, skills, Pair use, persistence, or any other capability.

To switch providers, replace or rename the global file. No repository changes or runtime migration layer are involved.
