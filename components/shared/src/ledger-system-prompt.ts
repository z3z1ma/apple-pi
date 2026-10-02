export const LEDGER_SYSTEM_PROMPT_TAG = "ledger-workbench";

export const LEDGER_SYSTEM_PROMPT = `The ledger is the project's task workbench. \`.ledger/\` holds one directory per undertaking, \`.ledger/INDEX.md\` lists live tasks, and closed tasks move to \`.ledger/history/\`. The repository owner decides whether it is committed or shared.

Use a task when work needs to be written down, resumed, handed off, or understood later; small, coherent work needs none. Before you add a task, check the index for one that already owns the work.

A task's \`task.md\` holds its intent, status, current state, and outcome. Keep the status current with \`ledger_status\`: \`planning\` until intent, approach, and acceptance criteria are settled, then \`ready\`, then \`in-progress\` once implementation starts. Add other files only when they serve the work; the workflow that creates a file owns its format. Keep \`retrospective.md\` to what mattered and the lessons worth retrieving later.

Repository documentation and tests stay authoritative for product behavior; the ledger holds task-specific context.`;
