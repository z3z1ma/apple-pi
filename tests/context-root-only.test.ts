import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runInChildSessionContext } from "../components/subagents/src/child-context.js";
import { createEventBus } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.js";
import {
	createExtensionRuntime,
	loadExtensions,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";

async function loadContextExtension() {
	return loadExtensions(["extensions/context.ts"], process.cwd(), createEventBus(), createExtensionRuntime());
}

function surfaces(result: Awaited<ReturnType<typeof loadContextExtension>>) {
	const extension = result.extensions[0];
	return {
		errors: result.errors,
		commands: new Set(result.extensions.flatMap((item) => [...item.commands.keys()])),
		tools: new Set(result.extensions.flatMap((item) => [...item.tools.keys()])),
		handlers: extension?.handlers ?? new Map(),
	};
}

describe("standalone context extension", () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
		delete process.env.PI_CODING_AGENT_DIR;
	});

	function isolate() {
		const root = mkdtempSync(join(tmpdir(), "apple-pi-context-root-"));
		directories.push(root);
		process.env.PI_CODING_AGENT_DIR = root;
	}

	it("registers only search_session on the main session", async () => {
		isolate();
		const loaded = surfaces(await loadContextExtension());
		expect(loaded.errors).toEqual([]);
		expect(loaded.tools.has("search_session")).toBe(true);
		expect(loaded.tools.has("revisit_note")).toBe(false);
		expect(loaded.commands.size).toBe(0);
		expect(loaded.handlers.has("turn_end")).toBe(false);
		expect(loaded.handlers.has("context")).toBe(false);
	});

	it("registers the same search-only surface in a child session", async () => {
		isolate();
		const loaded = surfaces(await runInChildSessionContext(() => loadContextExtension()));
		expect(loaded.errors).toEqual([]);
		expect(loaded.tools.has("search_session")).toBe(true);
		expect(loaded.tools.has("revisit_note")).toBe(false);
		expect(loaded.commands.size).toBe(0);
		expect(loaded.handlers.has("turn_end")).toBe(false);
		expect(loaded.handlers.has("context")).toBe(false);
	});
});
