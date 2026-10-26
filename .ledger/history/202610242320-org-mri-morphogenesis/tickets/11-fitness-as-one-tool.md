# 11: Fitness as one tool among the others

Part of the approved spec [../spec.md](../spec.md), as redirected by [../direction.md](../direction.md) and the operator's sign-off notes of 2026-10-26: fitness is completed, and exposed as `org_fitness`, one instrument among the inspection tools, never the driving function.

**What to build:** The `fitness` tool is renamed `org_fitness`, with a description that presents it as one instrument for comparing in dollars, beside `org_waits`, `org_work`, `org_communication`, and `org_expertise`, not as an objective. It takes the same scope options as the inspection tools where they apply (the organization, a person's subtree). Prompts, docs, and tests use the new name; nothing keeps the old one (no consumers outside this repository).

**Blocked by:** 10 (Who talks to whom).

**Status:** done (53303ff9)

Verified: work/coordinator/fitness49/49, loader, Node/web typecheck, Biome and context lint154/154. Independent review found no open finding in this bounded rename; evaluator/handler/schema unchanged. Operator approved16/16 hunks. No live reload/full-suite claim.

- [x] Through a faux session a person calls `org_fitness` with a window and gets the same result `fitness` gave; no tool named `fitness` remains.
- [x] The tool description presents fitness as one instrument beside the four inspection tools and says it is not an objective.
- [x] The package-load smoke test lists `org_fitness` and not `fitness`; docs and context files use the new name.
