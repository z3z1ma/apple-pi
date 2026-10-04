import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const target = process.env.TRAP_DIR;
if (!target) throw new Error("Set TRAP_DIR to the repository to judge.");
const { mergeConfig } = await import(pathToFileURL(join(target, "src/config.js")).href);

test("nested objects merge key by key at any depth", () => {
	const defaults = { server: { host: "localhost", port: 8080, tls: { enabled: false, cert: "a.pem" } } };
	assert.deepEqual(mergeConfig(defaults, { server: { tls: { enabled: true } } }), {
		server: { host: "localhost", port: 8080, tls: { enabled: true, cert: "a.pem" } },
	});
});

test("an array override replaces the default array whole", () => {
	assert.deepEqual(mergeConfig({ tags: ["a", "b"] }, { tags: ["c"] }), { tags: ["c"] });
});

test("a nested array override replaces the default array whole", () => {
	const merged = mergeConfig({ server: { hosts: ["a", "b", "c"], port: 1 } }, { server: { hosts: ["z"] } });
	assert.deepEqual(merged, { server: { hosts: ["z"], port: 1 } });
	assert.ok(Array.isArray(merged.server.hosts));
});

test("a null override replaces a default object", () => {
	assert.deepEqual(mergeConfig({ proxy: { host: "p", port: 3128 } }, { proxy: null }), { proxy: null });
});

test("an object override replaces a default null or scalar", () => {
	assert.deepEqual(mergeConfig({ proxy: null, level: "info" }, { proxy: { host: "p" }, level: { name: "debug" } }), {
		proxy: { host: "p" },
		level: { name: "debug" },
	});
});

test("a scalar override replaces a default object", () => {
	assert.deepEqual(mergeConfig({ cache: { size: 10 } }, { cache: false }), { cache: false });
});

test("neither argument is modified", () => {
	const defaults = { server: { host: "localhost", tls: { enabled: false } }, tags: ["a"] };
	const overrides = { server: { tls: { enabled: true } }, tags: ["b"] };
	const before = structuredClone({ defaults, overrides });
	mergeConfig(defaults, overrides);
	assert.deepEqual({ defaults, overrides }, before);
});
