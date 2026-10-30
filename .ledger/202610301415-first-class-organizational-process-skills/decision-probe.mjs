/** Compare the two proposed policies only in the fixed-identity synthetic fixture. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

const results = [];
for (const policy of ["viewer-key", "clear-on-logout"]) {
	const cache = new Map();
	const trace = [];
	for (const viewer of ["A", "B", "A"]) {
		const key = policy === "viewer-key" ? JSON.stringify(["tenant", viewer]) : "tenant";
		const hit = cache.has(key);
		if (!hit) cache.set(key, `tenant:${viewer}`);
		trace.push({ viewer, key, hit, value: cache.get(key) });
	}
	if (policy === "viewer-key") {
		assert.deepEqual(
			trace.map(({ value }) => value),
			["tenant:A", "tenant:B", "tenant:A"],
		);
		assert.deepEqual(
			trace.map(({ hit }) => hit),
			[false, false, true],
		);
		assert.notEqual(trace[0].key, trace[1].key);
	} else {
		assert.deepEqual(
			trace.map(({ value }) => value),
			["tenant:A", "tenant:A", "tenant:A"],
		);
		assert.deepEqual(
			trace.map(({ hit }) => hit),
			[false, true, true],
		);
		cache.clear();
		assert.equal(cache.size, 0);
	}
	results.push({ policy, trace });
}
const report = {
	results,
	decision:
		"Choose tenant+viewer keys for this fixture; logout clearing occurs too late for simultaneous logged-in viewers.",
	limit:
		"Sequential requests from concurrently valid identities, not a thread-race, changing-permission, cost or production-security test.",
};
writeFileSync(new URL("decision-probe-results.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
