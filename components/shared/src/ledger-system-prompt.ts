export const LEDGER_SYSTEM_PROMPT_TAG = "ledger-workbench";

export const LEDGER_SYSTEM_PROMPT = `<ledger-workbench>
# .ledger workbench

A repository may use \`.ledger\` as a plain-Markdown workbench for non-trivial, multi-step work. The transcript is not durable task state. Use the ledger when the user asks for it, when a prepared ledger task governs the work, or when long-running work needs a cold-start contract. Do not create ledger ceremony for a small one-off change unless the user asks.

## Authority and storage

- One task owns one coherent observable outcome.
- \`.ledger/INDEX.md\` is the live navigation index. Rows include title and description for search. Status exists only in each task's \`task.md\`.
- Closed tasks move to \`.ledger/history/\`. \`.ledger/history/INDEX.md\` lists each archived bundle with terminal status, title, and description.
- A live task bundle is \`.ledger/YYYYMMDDhhmm-lowercase-kebab-slug/\`; the timestamp is a valid local calendar minute and its date matches the task's \`Created\` header.
- Teams commonly ignore \`/.ledger/\`; solo repositories may commit it. Never edit \`.gitignore\`, commit, push, deploy, or publish merely because a ledger exists.
- The ledger is working state, not a second project wiki. Promote durable results to the repository's real docs, ADRs, runbooks, tests, or configured skills.

## Ledger tools

- \`ledger_add\` creates a new full directory tree, structural \`task.md\`, and live index row with title and description.
- \`ledger_close\` archives a live task as \`done\` or \`cancelled\`: it updates \`Status\` in \`task.md\` when needed, moves the bundle to \`.ledger/history/\`, removes the live index row, and appends a history row that includes the terminal status, title, and description. It does not verify completeness.
- Use those tools only to create or archive a task. They do not list, inspect, select, activate, or execute tasks.
- Read and edit existing ledger files with ordinary repository tools. There is no ambient active-task pointer or ledger UI state in model context.

## Bundle layout

Every new task contains exactly one executable root and these supporting directories:

\`\`\`text
.ledger/
  INDEX.md
  YYYYMMDDhhmm-lowercase-kebab-slug/
    task.md
    specs/
    plans/
    research/
    decisions/
    evidence/
    knowledge/
    skills/
  history/
    INDEX.md
    YYYYMMDDhhmm-lowercase-kebab-slug/
\`\`\`

Create supporting records only when they have a concrete consumer; empty supporting directories do not require ceremonial files. Supporting records stay inside their owning bundle. Cross-task edges point only to another task root.

## Task root contract

A \`task.md\` has canonical headers, exactly one level-one title, and these sections in order:

\`\`\`markdown
Status: open
Created: YYYY-MM-DD
Updated: YYYY-MM-DD
Depends-On: .ledger/<completed-task-id>/task.md

# One bounded outcome

## Scope

The complete outcome this task owns.

## Non-goals

- Adjacent work deliberately excluded.

## Acceptance Criteria

- AC-001: One observable success outcome.
- AC-002: One observable boundary or failure outcome.

## Work Items

- [ ] WI-001: One stable implementation decomposition item.

## References

- Governing task-local records and ordinary repository paths.

## Assumptions

- Each execution-changing assumption is record-backed, explicitly user-ratified, or blocking.

## Journal

- YYYY-MM-DD: Material action, discovery, or decision.

## Blockers

None.

## Evidence

Observed checks mapped to acceptance criteria, including limits.

## Review

Confirmed review findings and their disposition.

## Retrospective

What the work taught and what should change next time.

## Distillation

Where durable outcomes were promoted, or a substantive reason no promotion is warranted.
\`\`\`

Rules:

- Task status is \`open | active | blocked | done | cancelled\`.
- \`Depends-On\` is optional. Multiple canonical task-root paths are comma-separated and keep the live identity form \`.ledger/<task-id>/task.md\`. Resolve a dependency at that live path if present, otherwise at \`.ledger/history/<task-id>/task.md\`. A dependency is ready when the resolved \`task.md\` exists and its Status is \`done\`. Do not rewrite other tasks' Depends-On lines when archiving. Cycles are invalid.
- Acceptance criteria use stable \`AC-###\` IDs and describe observable outcomes or durable invariants, including important failure boundaries.
- Work Items are optional implementation decomposition, never proof of acceptance. When present, \`## Work Items\` appears only between Acceptance Criteria and References and uses \`WI-###\` rows: \`[ ]\` open, \`[x]\` complete, or \`[-]\` cancelled with a substantive \`Cancelled:\` reason.
- \`Blockers\` is \`None.\` only when inspection supports readiness. New tasks begin blocked by incomplete shaping; replace every placeholder before execution.
- \`Evidence\`, \`Review\`, \`Retrospective\`, and \`Distillation\` describe observed results. Never manufacture success or mark anticipated work complete.

## Supporting records

Every supporting Markdown record except a task-local skill starts with \`Status\`, \`Created\`, and \`Updated\`.

- \`specs/**/*.md\`: shared behavioral contracts—actors, boundaries, required/error behavior, scenarios, exclusions, assumptions, and acceptance mapping. Status \`draft | active | superseded\`; only active specs govern execution.
- \`plans/**/*.md\`: source-backed implementation sequence, change surfaces, criterion-to-check mapping, risks, and integration points. Status \`active | done\`.
- \`decisions/**/*.md\`: consequential choices with context, authority, steelmanned alternatives, consequences, and revisit conditions. Status \`active | superseded\`; only active decisions govern execution.
- \`research/**/*.md\`: question or hypothesis, dated sources and methods, findings including null results, conclusions, and limits. Status \`active | done | superseded\`.
- \`evidence/**/*.md\`: observations that should outlive one routine check, including procedure, what they support or challenge, and limits. Status \`recorded\`.
- \`knowledge/**/*.md\`: task-local vocabulary, conventions, or hard-won boundaries needed across iterations. Status \`active\`.
- \`skills/<slug>/SKILL.md\`: task-local candidate procedures with trigger, prerequisites, procedure, and validation. They are not ambient host skills merely because they exist.

Review, routine evidence, Journal, Blockers, Retrospective, and Distillation remain in \`task.md\`; do not create duplicate standalone records.

## Operating discipline

1. Read \`.ledger/INDEX.md\`, the governing \`task.md\`, every referenced active record, and relevant repository authority before implementation. Resolve closed dependencies through \`.ledger/history/\`.
2. Resolve missing scope, assumptions, dependencies, and blockers by shaping the records; never weaken them to make work start.
3. Select the smallest coherent unfinished acceptance gap or work item. Treat dependencies and references as context, not extra implementation authority.
4. During work, keep Status, Work Items, Journal, Blockers, and References honest. Record only observed evidence and confirmed review outcomes.
5. A completed work item does not satisfy an acceptance criterion. A passing check proves only what it actually exercised.
6. Mark \`done\` only when every acceptance criterion has observed evidence, dependencies are done, Blockers is \`None.\`, work items are complete or substantively cancelled, review findings are resolved or explicitly bounded, and Retrospective and Distillation are substantive.
7. If work pauses, blocks, or is cancelled, record that state honestly; never manufacture \`done\`.
8. At each meaningful iteration and closure, promote durable knowledge to its real repository owner. Independent unfinished outcomes become separately indexed tasks rather than hidden scope expansion.

When lifecycle skills are available, use the matching shaping, research, specification, planning, execution, Ralph, review, and distillation skill. The ledger contract above still governs agents that run without skills or extensions.
</ledger-workbench>`;

export function appendLedgerSystemPrompt(systemPrompt: string): string {
	if (systemPrompt.includes(`<${LEDGER_SYSTEM_PROMPT_TAG}>`)) return systemPrompt;
	const base = systemPrompt.trim();
	return base ? `${base}\n\n${LEDGER_SYSTEM_PROMPT}` : LEDGER_SYSTEM_PROMPT;
}
