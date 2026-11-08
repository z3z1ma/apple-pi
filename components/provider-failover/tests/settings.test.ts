import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { providerFailoverEnabled } from "../src/settings.js";

const roots: string[] = [];
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "apple-pi-failover-settings-"));
	roots.push(root);
	const global = join(root, "agent");
	const project = join(root, "project", ".pi");
	mkdirSync(global, { recursive: true });
	mkdirSync(project, { recursive: true });
	vi.stubEnv("PI_CODING_AGENT_DIR", global);
	return { global, project, path: join(global, "settings.json") };
}

afterEach(() => {
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("global-only failover permission", () => {
	it("defaults off, including when only project settings opt in", () => {
		const { project } = fixture();
		writeFileSync(join(project, "settings.json"), JSON.stringify({ providerFailover: true }));
		expect(providerFailoverEnabled()).toBe(false);
	});

	it.each([true, false])("reads global boolean %s without changing any settings", (enabled) => {
		const { path, project } = fixture();
		const contents = JSON.stringify({ providerFailover: enabled, defaultModel: "existing" });
		writeFileSync(path, contents);
		writeFileSync(join(project, "settings.json"), JSON.stringify({ providerFailover: !enabled }));
		expect(providerFailoverEnabled()).toBe(enabled);
		expect(readFileSync(path, "utf8")).toBe(contents);
	});

	it("accepts native settings' optional BOM and ignores unrelated fields", () => {
		const { path } = fixture();
		writeFileSync(path, '\uFEFF{"providerFailover":true,"defaultModel":"existing"}');
		expect(providerFailoverEnabled()).toBe(true);
		writeFileSync(path, '{"defaultModel":"existing"}');
		expect(providerFailoverEnabled()).toBe(false);
	});

	it.each([null, [], {}, "true", 1])("rejects a non-boolean flag: %j", (value) => {
		const { path } = fixture();
		writeFileSync(path, JSON.stringify({ providerFailover: value }));
		expect(() => providerFailoverEnabled()).toThrow("expected a boolean");
	});

	it.each(["null", "[]", "1", '"text"', "{broken secret-value"])(
		"rejects invalid settings without echoing file content: %s",
		(contents) => {
			const { path } = fixture();
			writeFileSync(path, contents);
			expect(() => providerFailoverEnabled()).toThrow("expected a JSON object");
			try {
				providerFailoverEnabled();
			} catch (error) {
				expect((error as Error).message).not.toContain("secret-value");
			}
		},
	);
});
