const RALPH_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write"];
// Adapt references/ledger-increment.md for the goal and inline it before running this template.
const RALPH = "<adapt references/ledger-increment.md for this goal and inline it here>";

// Adapt this escape hatch to the batch: two near-empty code changes are usually a signal to return control.
const LOW_MUTATION_SCORE = 3;
const MAX_CONSECUTIVE_LOW_MUTATION = 2;

const goal = (inputs.goal || "").trim();
const task = (inputs.task || "").trim();
const stack = (inputs.stack || "")
  .split("\n")
  .map((path) => path.trim())
  .filter(Boolean);
const iterationInput = String(inputs.iterations ?? "");
if (!goal) throw new Error("inputs.goal is required");
if (!task) throw new Error("inputs.task is required (ledger task.md path)");
if (stack.length === 0) throw new Error("inputs.stack is required (newline-separated context paths)");
if (!/^[1-9]\d*$/.test(iterationInput)) {
  throw new Error("inputs.iterations is required (canonical positive integer)");
}
const iterations = Number(iterationInput);
if (!Number.isSafeInteger(iterations)) {
  throw new Error("inputs.iterations must be a safe positive integer");
}

const workerStack = [...new Set([task, ...stack])];
const failures = [];

async function terminalTaskStatus() {
  const matches = await pi.grep({ path: task, pattern: "^Status:\\s*(?:done|blocked)\\s*$" });
  return /Status:\s*(done|blocked)\b/.exec(matches)?.[1];
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

async function mutationSnapshot() {
  const change = await std.git.change({ paths: [".", ":(exclude).ledger/**"] });
  const fingerprints = await Promise.all(change.untrackedFiles.map(async (path) => {
    const result = await pi.bash({
      command: `if [ -f ${shellQuote(path)} ]; then git hash-object -- ${shellQuote(path)}; else printf MISSING; fi`,
    });
    if (!result.ok) throw new Error(`could not fingerprint untracked path ${path}`);
    return [path, result.output.trim()];
  }));
  return { patch: change.patch, untracked: Object.fromEntries(fingerprints) };
}

function changedLines(before, after) {
  if (before === after) return 0;
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) suffix++;
  const count = (text) => text ? text.split("\n").filter(Boolean).length : 0;
  return Math.max(count(before.slice(prefix, before.length - suffix)), count(after.slice(prefix, after.length - suffix)));
}

function mutationScore(before, after) {
  const untrackedChanges = new Set([...Object.keys(before.untracked), ...Object.keys(after.untracked)]).size
    ? [...new Set([...Object.keys(before.untracked), ...Object.keys(after.untracked)])].filter(
        (path) => before.untracked[path] !== after.untracked[path],
      ).length
    : 0;
  return changedLines(before.patch, after.patch) + untrackedChanges * LOW_MUTATION_SCORE;
}

function stopped(stopReason, completedIterations, details = {}) {
  return { status: "stopped", stopReason, requestedIterations: iterations, completedIterations, failures, ...details };
}

let lowMutationStreak = 0;
for (let iteration = 1; iteration <= iterations; iteration++) {
  const statusBefore = await terminalTaskStatus();
  if (statusBefore) return stopped(`task-${statusBefore}`, iteration - 1);

  const before = await mutationSnapshot();
  const result = await agents.run({
    name: `ralph-${iteration}`,
    profile: "coding",
    advisor: true,
    tools: RALPH_TOOLS,
    systemPrompt: RALPH,
    task: `Goal:\n${goal}`,
    context: { stack: workerStack },
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

  const statusAfter = await terminalTaskStatus();
  if (statusAfter) return stopped(`task-${statusAfter}`, iteration);

  const score = mutationScore(before, await mutationSnapshot());
  lowMutationStreak = score < LOW_MUTATION_SCORE ? lowMutationStreak + 1 : 0;
  if (lowMutationStreak >= MAX_CONSECUTIVE_LOW_MUTATION) {
    return stopped("low-mutation", iteration, { lowMutationStreak, lastMutationScore: score });
  }
}

return {
  status: "completed",
  requestedIterations: iterations,
  completedIterations: iterations,
  failures,
};
