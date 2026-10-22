import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("guides work through interns and peers instead of removed delegation tools", () => {
	// Python's agent function remains valid; the native agent tool is gone.
	const removed =
		/\b(?:get_subagent_result|steer_subagent|stop_subagent|subagent_type)\b|\bsub-?agents?\b|<subagent-team>|`agent` (?:tool|session)|direct `agent`|subagents\.json|\.pi\/agents/;
	const stale: string[] = [];
	for (const directory of ["skills", "prompts"]) {
		for (const name of readdirSync(directory, { recursive: true, encoding: "utf8" })) {
			if (!/\.(md|py)$/.test(name)) continue;
			const path = join(directory, name);
			if (removed.test(readFileSync(path, "utf8"))) stale.push(path);
		}
	}
	expect(stale).toEqual([]);
});
