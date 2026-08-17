import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEventBus } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.js";
import {
	createExtensionRuntime,
	loadExtensions,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";

describe("standalone VCC extension", () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
		delete process.env.PI_VCC_CONFIG_PATH;
		delete process.env.PI_CODING_AGENT_DIR;
	});

	it("registers VCC without observational memory", async () => {
		const root = mkdtempSync(join(tmpdir(), "apple-pi-vcc-standalone-"));
		directories.push(root);
		process.env.PI_VCC_CONFIG_PATH = join(root, "vcc.json");
		process.env.PI_CODING_AGENT_DIR = root;

		const result = await loadExtensions(
			["extensions/vcc.ts"],
			process.cwd(),
			createEventBus(),
			createExtensionRuntime(),
		);
		expect(result.errors).toEqual([]);
		expect(result.extensions).toHaveLength(1);

		const commands = new Set(result.extensions.flatMap((extension) => [...extension.commands.keys()]));
		const tools = new Set(result.extensions.flatMap((extension) => [...extension.tools.keys()]));
		expect(commands.has("pi-vcc")).toBe(true);
		expect(commands.has("pi-vcc-recall")).toBe(true);
		expect(tools.has("session_search")).toBe(true);
		expect(commands.has("om:status")).toBe(false);
		expect(commands.has("om:view")).toBe(false);
		expect(tools.has("memory_source")).toBe(false);
		expect(tools.has("recall")).toBe(false);
	});
});
