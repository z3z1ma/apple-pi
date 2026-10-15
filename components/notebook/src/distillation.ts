import { type Reflection, reflectionToSummaryLine } from "./session-ledger/index.js";

const DISTILL_INSTRUCTION = `Distill the open learnings of this session. Decide for each one:

- **Durable:** it will help future work in this project. Place it by how a future agent finds it, then retire it with update_notebook, unless it still guides the current work.
  - \`.pi/LEARNINGS.md\` loads into every session, like AGENTS.md. Keep it to short instructions that should change behavior on every turn.
  - A \`.wiki/\` page is found only by search. Use it for project knowledge, under a name a search would match.
  - A ledger task's \`retrospective.md\` is read when someone works on a related task. Use it for lessons about that undertaking.
  - \`.pi/programs/\` holds a reusable \`pi_exec\` composition, which becomes a tool.
  - A source file's context file, \`.context/<path>.md\` mirroring its path, is delivered whenever an agent reads or edits that file. Use it for an invariant, hazard, or cross-file coupling of that one file that its code cannot show. You may create a missing context file for such a non-obvious learning; state its reason as \`Why:\`, and add \`Coupled:\` or \`Verify:\` when they apply. Run \`context_lint\` after you change a context file. In your reply, name each context file you create as \`Created context file: <path>\` and each existing invariant you change or remove as \`Changed invariant: <file>#<section>, because <reason>\`.
- **Current:** it still guides the work now but will not matter later. Keep it open.
- **Stale:** it no longer holds or is not worth keeping. Retire it.

Read each destination before you edit it and merge with what is there. Keep \`.pi/LEARNINGS.md\` short: merge duplicates and remove lines that no longer hold. Write only non-sensitive synthesis: leave out credentials and private transcript text. Changes to AGENTS.md, docs, skills, code, or files outside the project belong to \`/promote\`, which the user runs.`;

/** The distill instruction with every open learning listed, since the caller may not have seen all of them. */
export function distillPrompt(learnings: readonly Reflection[]): string {
	return `${DISTILL_INSTRUCTION}\n\nOpen learnings:\n${learnings.map(reflectionToSummaryLine).join("\n")}`;
}
