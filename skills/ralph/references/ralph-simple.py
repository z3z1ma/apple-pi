import re
from typing import Any

# Adapt the increment prompt to the caller's goal and inline it before running.
RALPH = "<adapt references/simple-increment.md for this goal and inline it here>"
RALPH += " Implement one coherent increment. Never commit, push, merge, deploy, publish, reset, or invoke review. The caller owns validation and integration."
LOW_MUTATION_SCORE = 3
MAX_CONSECUTIVE_LOW_MUTATION = 2

async def mutationSnapshot() -> str:
    # The working-tree target includes untracked files, so one patch covers every edit.
    change = await git_change(paths=["."])
    return change["patch"]

def binarySections(patch: str) -> dict[str, str]:
    # A binary edit is one unchanged "Binary files ... differ" line plus a new object ID, so line counts miss it.
    sections: dict[str, str] = {}
    for section in ("\n" + patch).split("\ndiff --git ")[1:]:
        if "\nBinary files " in section:
            sections[section.split("\n")[0]] = section
    return sections

def mutationScore(before: str, after: str) -> int:
    beforeBinary = binarySections(before)
    afterBinary = binarySections(after)
    headers = set(beforeBinary) | set(afterBinary)
    binaryChanges = len([header for header in headers if beforeBinary.get(header) != afterBinary.get(header)])
    return changedLines(before, after) + binaryChanges * LOW_MUTATION_SCORE

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
    # No ledger state owner for the simple loop.
    failures: list[Any] = []
    lowMutationStreak = 0
    for iteration in range(1, iterations + 1):
        # Each peer starts only after the previous one settles.
        before = await mutationSnapshot()
        result = await agent_run(role="implementation-engineer", name=f"ralph-{iteration}",
                                 task=RALPH + "\n\nGoal:\n" + goal, context={"stack": stack})
        if result["status"] != "completed":
            failures.append({"iteration": iteration, "error": result.get("error") or "increment failed"})
            return {"status": "failed", "requestedIterations": iterations, "completedIterations": iteration - 1,
                    "failedAt": iteration, "failures": failures}
        # Low mutation is an escape hatch, not a completion judgment.
        score = mutationScore(before, await mutationSnapshot())
        lowMutationStreak = lowMutationStreak + 1 if score < LOW_MUTATION_SCORE else 0
        if lowMutationStreak >= MAX_CONSECUTIVE_LOW_MUTATION:
            return {"status": "stopped", "stopReason": "low-mutation", "requestedIterations": iterations,
                    "completedIterations": iteration, "failures": failures, "lowMutationStreak": lowMutationStreak,
                    "lastMutationScore": score}
    return {"status": "completed", "requestedIterations": iterations, "completedIterations": iterations, "failures": failures}

await main()
