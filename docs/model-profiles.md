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

Profile names are exact and case-sensitive. Unknown fields and partial bundles are invalid. An absent, malformed, unknown, or unavailable selected profile fails visibly; apple-pi does not substitute another model or inspect an older configuration format.

The package documents these semantic workload names; bundled consumers select them as shown:

| Workload | Consumers |
| --- | --- |
| `quick` | Explore, Research |
| `balanced` | General-purpose custom agents and explicit worker overrides |
| `deep` | Plan, Counsel, Advisor, review workers |
| `coding` | Implement, Ralph increments |
| `visual-engineering` | Design |
| `background` | Observational memory |

Custom Markdown agents may select any user-defined profile with `profile:`. The interactive `Agent` tool and `pi_exec` workers may override a type's default with `profile`. A generic `agents.run` worker may select a profile without selecting a type; without either, it inherits the parent session's model and thinking.

Profiles select only model and thinking. They never grant tools, write access, extensions, skills, Advisor use, persistence, or any other capability.

To switch providers, replace or rename the global file. No repository changes or runtime migration layer are involved.
