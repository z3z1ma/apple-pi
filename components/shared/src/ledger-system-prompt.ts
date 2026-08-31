export const LEDGER_SYSTEM_PROMPT_TAG = "ledger-workbench";

export const LEDGER_SYSTEM_PROMPT = `<ledger-workbench>
# The ledger

The ledger is \`.ledger/\`, searchable project-local operational memory for executing changes. Its task directories hold plans, specifications, notes, decisions, evidence, assets, progress, outcomes, and retrospectives so models and humans can understand, resume, or audit long-horizon work. \`.ledger/INDEX.md\` is the map; closed tasks live under \`.ledger/history/\`.

Check the index for an existing task that owns the undertaking before creating one. Use the ledger when work needs to be written down, resumed, handed off, or understood later; small coherent work need not create a task.

Each task has \`task.md\` for its identity, status, intent, current state, and outcome. Add only useful artifacts. Plans, specifications, notes, decisions, evidence, and assets belong in the task directory when they help continuity. Every new task also has \`retrospective.md\`: keep it concise and use it to distill what mattered and lessons worth retrieving without replaying operational context.

\`ledger_add\` creates a task directory and index entry. \`ledger_close\` archives it; it does not judge whether work is complete. Read and edit existing ledger files with ordinary repository tools. Repository documentation and tests retain durable product authority; task-specific execution context stays in the ledger.
</ledger-workbench>`;

export function appendLedgerSystemPrompt(systemPrompt: string): string {
	if (systemPrompt.includes(`<${LEDGER_SYSTEM_PROMPT_TAG}>`)) return systemPrompt;
	const base = systemPrompt.trim();
	return base ? `${base}\n\n${LEDGER_SYSTEM_PROMPT}` : LEDGER_SYSTEM_PROMPT;
}
