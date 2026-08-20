const RALPH_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write"];
// Adapt references/increment.md for the goal and inline it before running this template.
const RALPH = "<adapt references/increment.md for this goal and inline it here>";

const goal = (inputs.goal || "").trim();
const stack = (inputs.stack || "")
	.split("\n")
	.map((path) => path.trim())
	.filter(Boolean);
const iterationInput = String(inputs.iterations ?? "");
if (!goal) throw new Error("inputs.goal is required");
if (stack.length === 0) throw new Error("inputs.stack is required (newline-separated context paths)");
if (!/^[1-9]\d*$/.test(iterationInput)) {
	throw new Error("inputs.iterations is required (canonical positive integer)");
}
const iterations = Number(iterationInput);
if (!Number.isSafeInteger(iterations)) {
	throw new Error("inputs.iterations must be a safe positive integer");
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
	if (result.status !== "completed") {
		failures.push({ iteration, error: result.error || "increment failed" });
		return {
			status: "failed",
			requestedIterations: iterations,
			completedIterations: iteration - 1,
			failedAt: iteration,
			failures,
		};
	}
}

return {
	status: "completed",
	requestedIterations: iterations,
	completedIterations: iterations,
	failures,
};
