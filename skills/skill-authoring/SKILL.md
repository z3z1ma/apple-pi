---
name: skill-authoring
description: "Use when creating, editing, or verifying an Agent Skill for a reusable procedure, technique, pattern, or reference."
---

# Author Agent Skills

Write the smallest durable guidance that helps a capable model recognize and perform a recurring job. Skills are procedural context, not miniature applications or proof systems.

## Start from the real need

A skill is justified when a procedure recurs, an observed failure deserves reusable guidance, the operator explicitly requests one, or a stable reference will save future work. A clear operator request is enough authority to write it.

Keep project-specific facts in project documentation or instructions. Automate genuinely mechanical invariants only when a production consumer needs enforcement.

## Package shape

```text
skills/
  skill-name/
    SKILL.md
    supporting-file.*   # only when directly consumed and genuinely useful
```

`SKILL.md` frontmatter requires:

```yaml
---
name: lowercase-hyphen-name
description: "Use when ..."
---
```

- `name` uses letters, numbers, and hyphens and matches the directory.
- `description` states triggering conditions, not a compressed workflow.
- Keep the description concrete and searchable.
- Keep the skill concise enough to load economically.

## Write for frontier models

Assume strong judgment. Provide:

- the durable objective and boundary;
- a short operating sequence when order matters;
- conditions that change behavior;
- concrete failure semantics or safety constraints;
- one excellent example only when prose would remain ambiguous;
- references or tools only when the skill actually consumes them.

Prefer positive recipes centered on the durable objective, concrete conditions, and common operating path. Keep hypothetical edge cases, duplicated guidance, and session narrative out of the skill.

## Progressive validation

Choose the cheapest validation that matches the skill:

### Reference or ordinary procedure

- inspect the skill for a clear trigger and usable guidance;
- load it through the real skill loader;
- verify package inclusion when packaged.

No fresh model run is required by default.

### Guidance responding to an observed failure

When a real failure motivated the change, preserve that example and, if useful, run one focused control/treatment check. Replicas or a custom harness are reserved for observed variance.

### High-risk discipline

For guidance governing destructive operations, security boundaries, costly migrations, or a repeatedly observed model failure under pressure, stronger scenario testing may be warranted. Keep it bounded to the concrete failure. Stop when the guidance corrects it without regression.

Validation stays cheaper than the guidance it supports. When the harness becomes the project, return to the direct validation path.

## Subagents

The root model authors and inspects normal skills directly. When independent evaluation is genuinely valuable, commission one complete evaluation with all relevant scenarios, then validate the response and make ordinary edits yourself.

## Supporting files

Add a supporting file only when:

- the production skill links to or executes it;
- it removes substantial reference weight or supplies a reusable tool/template; and
- removing it would make the skill materially less useful or correct.

Fixtures, manifests, evidence modules, and scripts belong only when the production skill consumes them.

## Discovery and maintenance

Future agents decide whether to load a skill from its name and description. Use trigger terms operators actually use and keep the body scannable with descriptive headings.

When editing an existing skill:

1. Identify the concrete behavior or retrieval gap.
2. Make the smallest change that addresses it.
3. Run the loader/package check and any directly relevant example.
4. Stop after the loader/package check; a behavioral campaign is reserved for risk or observed failure.

## Completion

A packaged skill is ready when its content is coherent, its loader discovers the correct name/path, required supporting files exist, and the relevant package check passes. Report those observations honestly; no separate review or deployment ceremony is implied.
