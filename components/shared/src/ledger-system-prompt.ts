export const LEDGER_SYSTEM_PROMPT_TAG = "ledger-workbench";

export const LEDGER_SYSTEM_PROMPT = `<ledger-workbench>
# The ledger

The ledger is a simple project-local convention: \`.ledger/\` contains one open-ended directory per undertaking. It gives task work a stable, searchable home without imposing an artifact schema. The repository owner decides whether it is ignored, committed, or shared. \`.ledger/INDEX.md\` maps live tasks; closed bundles live under \`.ledger/history/\`.

Check the index for an existing task that owns the undertaking before creating one. Use the ledger when work needs to be written down, resumed, handed off, or understood later; small coherent work need not create a task.

Each task has \`task.md\` for its identity, status, intent, current state, and outcome. Add only useful artifacts at any paths that serve the work. The skill or workflow that creates an artifact owns its format; living under \`.ledger/\` does not make it a ledger-wide schema. Every new task also has \`retrospective.md\`: keep it concise and use it to distill what mattered and lessons worth retrieving without replaying operational context.

\`ledger_add\` creates a task directory and index entry. \`ledger_close\` archives it; it does not judge whether work is complete. Read and edit existing ledger files with ordinary repository tools. Repository documentation and tests retain durable product authority; task-specific execution context stays in the ledger.
</ledger-workbench>`;

export function appendLedgerSystemPrompt(systemPrompt: string): string {
	if (systemPrompt.includes(`<${LEDGER_SYSTEM_PROMPT_TAG}>`)) return systemPrompt;
	const base = systemPrompt.trim();
	return base ? `${base}\n\n${LEDGER_SYSTEM_PROMPT}` : LEDGER_SYSTEM_PROMPT;
}
