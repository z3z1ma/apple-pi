// @program: {"description": "Run bounded fresh-context Ralph increments, each by a temporary implementation engineer; stop on low mutation or a finished ledger task.", "parameters": {"goal": {"type": "string", "description": "What the increments work toward"}, "iterations": {"type": "integer", "minimum": 1, "description": "The most increments to run"}, "stack": {"type": "array", "items": {"type": "string"}, "default": [], "description": "Context paths for each engineer"}, "task": {"type": "string", "default": "", "description": "A ledger task.md; the loop stops when its status is done or blocked"}}, "required": ["goal", "iterations"]}
const RALPH =
	"<adapt references/simple-increment.md or references/ledger-increment.md for this goal and inline it here>" +
	" Implement one coherent increment. Never commit, push, merge, deploy, publish, reset, or invoke review. The caller owns validation and integration.";
const LOW_MUTATION_SCORE = 3;
const MAX_CONSECUTIVE_LOW_MUTATION = 2;

const goal = inputs.goal.trim();
const task = inputs.task.trim();
const stack = [...new Set([task, ...inputs.stack].map((path) => path.trim()).filter(Boolean))];

async function snapshot() {
	const output = await tools.bash({
		verbatim: true,
		command:
			'index=$(mktemp) && cp "$(git rev-parse --git-path index)" "$index" && GIT_INDEX_FILE="$index" git add -A . && GIT_INDEX_FILE="$index" git write-tree; status=$?; rm -f "$index"; exit $status',
	});
	return output.trim().split("\n").at(-1);
}

async function mutationScore(before, after) {
	if (before === after) return 0;
	const output = await tools.bash({ verbatim: true, command: `git diff --numstat ${before} ${after}` });
	return output
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => line.split("\t"))
		.reduce(
			(score, [added, deleted]) =>
				score + (added === "-" ? LOW_MUTATION_SCORE : Math.max(Number(added), Number(deleted))),
			0,
		);
}

async function taskStatus() {
	if (!task) return undefined;
	return /^Status:\s*(done|blocked)\s*$/m.exec(await tools.read({ path: task }))?.[1];
}

const failures = [];
let lowMutationStreak = 0;
for (let iteration = 1; iteration <= inputs.iterations; iteration++) {
	const before = await taskStatus();
	if (before) return { status: "stopped", stopReason: `task-${before}`, completedIterations: iteration - 1, failures };
	const start = await snapshot();
	const result = await tools.temporary_peer({
		role: "implementation-engineer",
		task: `${RALPH}\n\nGoal:\n${goal}`,
		context: { stack },
	});
	if (result.status !== "completed") {
		failures.push({ iteration, error: result.error ?? "increment failed" });
		return { status: "failed", completedIterations: iteration - 1, failedAt: iteration, failures };
	}
	const after = await taskStatus();
	if (after) return { status: "stopped", stopReason: `task-${after}`, completedIterations: iteration, failures };
	const score = await mutationScore(start, await snapshot());
	lowMutationStreak = score < LOW_MUTATION_SCORE ? lowMutationStreak + 1 : 0;
	if (lowMutationStreak >= MAX_CONSECUTIVE_LOW_MUTATION)
		return {
			status: "stopped",
			stopReason: "low-mutation",
			completedIterations: iteration,
			lastMutationScore: score,
			failures,
		};
}
return { status: "completed", completedIterations: inputs.iterations, failures };
