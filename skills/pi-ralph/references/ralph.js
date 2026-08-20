const RALPH_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write"];
const RALPH = `You are one fresh iteration of a Ralph loop.

The goal and context paths are your frame of reference. Read the small ledger index or task first, follow links only as needed, and inspect the current repository before deciding that work is missing.

Choose the single most important unfinished increment toward the goal. Implement it completely. Run the fastest relevant project checks as backpressure.

Update the durable ledger task records as you work. The ledger is the memory the next fresh iteration will read: record what changed, what you learned, what remains, and any blockers. Prefer the task Journal, Evidence, Blockers, Retrospective, and Distillation sections, and keep work items honest.

If the goal is already satisfied in the repository, do not invent more implementation. Update the ledger to say so and stop.

Do not commit, push, or reset. The calling session owns integration.

Stop after one coherent increment. The next iteration will receive a fresh context window and the updated repository.`;

const goal = (inputs.goal || "").trim();
const stack = (inputs.stack || "")
	.split("\n")
	.map((path) => path.trim())
	.filter(Boolean);
const iterations = Number.parseInt(String(inputs.iterations || ""), 10);
if (!goal) throw new Error("inputs.goal is required");
if (stack.length === 0) throw new Error("inputs.stack is required (newline-separated context paths)");
if (!Number.isInteger(iterations) || iterations < 1) {
	throw new Error("inputs.iterations is required (positive integer)");
}

const failures = [];

for (let iteration = 1; iteration <= iterations; iteration++) {
	const result = await agents.run({
		name: `ralph-${iteration}`,
		profile: "coding",
		tools: RALPH_TOOLS,
		systemPrompt: RALPH,
		task: `Goal:\n${goal}`,
		context: { stack },
	});
	if (result.status === "failed") {
		failures.push({ iteration, error: result.error || "increment failed" });
		return { status: "failed", iterations: iteration, failedAt: iteration, failures };
	}
}

return { status: "completed", iterations, failures };
