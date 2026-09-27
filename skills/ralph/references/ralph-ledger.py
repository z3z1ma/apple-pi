import asyncio
import re
from typing import Any

RALPH_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write"]
# Adapt the increment prompt to the caller's goal and inline it before running.
RALPH = "<adapt references/ledger-increment.md for this goal and inline it here>"
RALPH += " Implement one coherent increment. Never commit, push, merge, deploy, publish, reset, or invoke review. The caller owns validation and integration."
LOW_MUTATION_SCORE = 3
MAX_CONSECUTIVE_LOW_MUTATION = 2

def shellQuote(value: str) -> str:
    return "'" + value.replace("'", "'\"'\"'") + "'"

async def fingerprint(path: str) -> list[str]:
    quoted = shellQuote(path)
    result = await bash(command=f"if [ -f {quoted} ]; then git hash-object -- {quoted}; else printf MISSING; fi")
    if not result["ok"]:
        raise ValueError("could not fingerprint untracked path " + path)
    return [path, result["output"].strip()]

async def mutationSnapshot() -> dict[str, Any]:
    change = await git_change(paths=[".", ":(exclude).ledger/**"])
    fingerprints = await asyncio.gather(*[fingerprint(path) for path in change["untrackedFiles"]])
    return {"patch": change["patch"], "untracked": {pair[0]: pair[1] for pair in fingerprints}}

def changedLines(before: str, after: str) -> int:
    if before == after:
        return 0
    prefix = 0
    while prefix < min(len(before), len(after)) and before[prefix] == after[prefix]:
        prefix += 1
    suffix = 0
    while suffix < min(len(before) - prefix, len(after) - prefix) and before[len(before) - suffix - 1] == after[len(after) - suffix - 1]:
        suffix += 1
    beforeMiddle = before[prefix:len(before) - suffix]
    afterMiddle = after[prefix:len(after) - suffix]
    return max(len([line for line in beforeMiddle.splitlines() if line]), len([line for line in afterMiddle.splitlines() if line]))

def mutationScore(before: Any, after: Any) -> int:
    paths = set(before["untracked"]) | set(after["untracked"])
    untrackedChanges = sum(1 for path in paths if before["untracked"].get(path) != after["untracked"].get(path))
    return changedLines(before["patch"], after["patch"]) + untrackedChanges * LOW_MUTATION_SCORE

async def main() -> dict[str, Any]:
    goal = inputs.get("goal", "").strip()
    stack = [path.strip() for path in inputs.get("stack", "").splitlines() if path.strip()]
    iterationInput = inputs.get("iterations", "")
    if not goal:
        raise ValueError("inputs.goal is required")
    if not re.fullmatch(r"[1-9][0-9]*", iterationInput):
        raise ValueError("inputs.iterations is required (canonical positive integer)")
    iterations = int(iterationInput)
    if iterations > 9007199254740991:
        raise ValueError("inputs.iterations must be a safe positive integer")
    task = inputs.get("task", "").strip()
    if not task or not stack:
        raise ValueError("inputs.task and inputs.stack are required for ledger Ralph")
    stack = list(dict.fromkeys([task, *stack]))
    failures: list[Any] = []
    lowMutationStreak = 0
    for iteration in range(1, iterations + 1):
        status = re.search(r"(?m)^Status:\s*(done|blocked)\s*$", await read(path=task))
        if status:
            return {"status": "stopped", "stopReason": "task-" + status.group(1), "requestedIterations": iterations,
                    "completedIterations": iteration - 1, "failures": failures}
        before = await mutationSnapshot()
        result = await agent_run(name=f"ralph-{iteration}", profile="coding", pair=True, tools=RALPH_TOOLS,
                                 system_prompt=RALPH, task="Goal:\n" + goal, context={"stack": stack})
        if result["status"] != "completed":
            failures.append({"iteration": iteration, "error": result.get("error") or "increment failed"})
            return {"status": "failed", "requestedIterations": iterations, "completedIterations": iteration - 1,
                    "failedAt": iteration, "failures": failures}
        status = re.search(r"(?m)^Status:\s*(done|blocked)\s*$", await read(path=task))
        if status:
            return {"status": "stopped", "stopReason": "task-" + status.group(1), "requestedIterations": iterations,
                    "completedIterations": iteration, "failures": failures}
        score = mutationScore(before, await mutationSnapshot())
        lowMutationStreak = lowMutationStreak + 1 if score < LOW_MUTATION_SCORE else 0
        if lowMutationStreak >= MAX_CONSECUTIVE_LOW_MUTATION:
            return {"status": "stopped", "stopReason": "low-mutation", "requestedIterations": iterations,
                    "completedIterations": iteration, "failures": failures, "lowMutationStreak": lowMutationStreak,
                    "lastMutationScore": score}
    return {"status": "completed", "requestedIterations": iterations, "completedIterations": iterations, "failures": failures}

await main()
