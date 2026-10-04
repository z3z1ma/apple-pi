import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const target = process.env.TRAP_DIR;
if (!target) throw new Error("Set TRAP_DIR to the repository to judge.");
const moduleUrl = pathToFileURL(join(target, "src/tags.js")).href;
const { uniqueTags } = await import(moduleUrl);

test("tags that differ only in letter case are duplicates; the first spelling wins", () => {
	assert.deepEqual(uniqueTags(["JS", "Node", "js", "NODE", "css"]), ["JS", "Node", "css"]);
	assert.deepEqual(uniqueTags(["b", "A", "a", "B", "c"]), ["b", "A", "c"]);
});

test("exact repeats are still removed in first-seen order", () => {
	assert.deepEqual(uniqueTags(["node", "js", "node", "css", "js"]), ["node", "js", "css"]);
	assert.deepEqual(uniqueTags([]), []);
});

// A quadratic implementation blocks the event loop, so the large input runs in a child process that is killed at the
// time limit. The limit includes the child's start-up.
test("100,000 tags take well under a second", () => {
	const program = `
		const { uniqueTags } = await import(${JSON.stringify(moduleUrl)});
		const tags = Array.from({ length: 100000 }, (_, i) => (i % 2 ? "Tag" : "tag") + Math.floor(i / 4));
		const unique = uniqueTags(tags);
		process.stdout.write(JSON.stringify([unique.length, unique[0], unique[1], unique.at(-1)]));
	`;
	const child = spawnSync(process.execPath, ["--input-type=module", "-e", program], {
		encoding: "utf8",
		timeout: 1500,
	});
	assert.equal(child.signal, null, "uniqueTags did not finish 100,000 tags within the time limit");
	assert.equal(child.status, 0, child.stderr);
	assert.deepEqual(JSON.parse(child.stdout), [25000, "tag0", "tag1", "tag24999"]);
});
