/** Synthetic exercise fixture; intentionally tenant-keyed, not application code. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

const trace = [];
function render(cache, viewer) {
	const key = "tenant";
	const hit = cache.has(key);
	if (!hit) cache.set(key, `tenant:${viewer}`);
	const value = cache.get(key);
	trace.push({ viewer, key, hit, value });
	return value;
}

assert.equal(render(new Map(), "B"), "tenant:B");
const shared = new Map();
assert.equal(render(shared, "A"), "tenant:A");
assert.equal(render(shared, "B"), "tenant:A");
assert.deepEqual(
	trace.map(({ hit }) => hit),
	[false, false, true],
);
assert.equal(trace[1].key, trace[2].key);
const result = {
	fixture: "Synthetic tenant-keyed cache with fixed viewer identities and permissions",
	trace,
	conclusion: "The constructed warm-cache case reuses A's value for B; the cold-B control succeeds.",
	limit: "This demonstrates the chosen probe in an authored faulty fixture, not a defect in any real application.",
};
writeFileSync(new URL("cache-probe-results.json", import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
