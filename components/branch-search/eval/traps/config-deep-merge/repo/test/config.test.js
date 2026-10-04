import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeConfig } from "../src/config.js";

test("an override replaces the default value", () => {
	assert.deepEqual(mergeConfig({ level: "info", color: true }, { level: "debug" }), { level: "debug", color: true });
});

test("keys only in the overrides are added", () => {
	assert.deepEqual(mergeConfig({ level: "info" }, { file: "app.log" }), { level: "info", file: "app.log" });
});

test("nested objects merge key by key", () => {
	const defaults = { server: { host: "localhost", port: 8080 }, level: "info" };
	assert.deepEqual(mergeConfig(defaults, { server: { port: 9090 } }), {
		server: { host: "localhost", port: 9090 },
		level: "info",
	});
});
