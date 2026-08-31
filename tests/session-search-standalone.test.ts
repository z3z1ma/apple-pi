import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEventBus } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.js";
import {
	createExtensionRuntime,
	loadExtensions,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";

describe("standalone search_session extension", () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
		delete process.env.PI_CODING_AGENT_DIR;
	});

	it("registers search_session without pair programmer notebook or a compact hook", async () => {
		const root = mkdtempSync(join(tmpdir(), "apple-pi-session-search-standalone-"));
		directories.push(root);
		process.env.PI_CODING_AGENT_DIR = root;

		const result = await loadExtensions(
			["extensions/session-search.ts"],
			process.cwd(),
			createEventBus(),
			createExtensionRuntime(),
		);
		expect(result.errors).toEqual([]);
		expect(result.extensions).toHaveLength(1);

		const commands = new Set(result.extensions.flatMap((extension) => [...extension.commands.keys()]));
		const tools = new Set(result.extensions.flatMap((extension) => [...extension.tools.keys()]));
		expect(tools.has("search_session")).toBe(true);
		expect(result.extensions[0]?.handlers.has("session_before_compact")).toBe(false);
		expect(commands.has("om:status")).toBe(false);
		expect(commands.has("om:view")).toBe(false);
		expect(tools.has("revisit_note")).toBe(false);
	});
});
