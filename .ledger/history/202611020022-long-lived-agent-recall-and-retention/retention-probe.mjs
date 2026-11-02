import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const [modulePath] = process.argv.slice(2);
if (!modulePath) throw new Error("Pass installed Pi dist/core/session-manager.js.");
const { buildSessionContext, SessionManager } = await import(pathToFileURL(modulePath));
const stamp = "2026-01-01T00:00:00.000Z";
const entry = (id, parentId, type, rest) => ({ id, parentId, type, timestamp: stamp, ...rest });
const history = [
	entry("think", null, "thinking_level_change", { thinkingLevel: "high" }),
	entry("old", "think", "message", { message: { role: "user", content: "old", timestamp: 1 } }),
	entry("keep", "old", "message", { message: { role: "user", content: "kept", timestamp: 2 } }),
	entry("cmp", "keep", "compaction", {
		summary: "summary",
		firstKeptEntryId: "keep",
		tokensBefore: 20,
		systemMessage: { role: "system", content: "prompt", timestamp: 3 },
	}),
	entry("new", "cmp", "message", { message: { role: "user", content: "new", timestamp: 4 } }),
];
const full = buildSessionContext(history, "new");
const cut = buildSessionContext(history.slice(3), "new");
assert.equal(full.thinkingLevel, "high");
assert.equal(cut.thinkingLevel, "off");
assert.equal(full.messages.length, 4);
assert.equal(cut.messages.length, 3);
const header = { type: "session", version: 3, id: "synthetic", timestamp: stamp, cwd: "/tmp" };
const sm = SessionManager.inMemory("/tmp", undefined, [header, ...history]);
sm.branch("old");
assert.equal(sm.getLeafId(), "old");
const resumed = SessionManager.inMemory("/tmp", undefined, [header, ...sm.getEntries()]);
assert.equal(resumed.getLeafId(), "new");
console.log(
	JSON.stringify(
		{
			syntheticChecks: 3,
			fullMessages: full.messages.length,
			cutMessages: cut.messages.length,
			fullThinking: full.thinkingLevel,
			cutThinking: cut.thinkingLevel,
			unwrittenBranchLeaf: sm.getLeafId(),
			reconstructedLeaf: resumed.getLeafId(),
			privateFilesRead: 0,
		},
		null,
		2,
	),
);
