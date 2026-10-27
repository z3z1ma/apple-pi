import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import {
	type BuildSystemPromptOptions,
	createEventBus,
	createExtensionRuntime,
	ExtensionRunner,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSystemPromptSection } from "../components/shared/src/system-prompt-section.js";
import { loadExtensions } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import { buildSystemPrompt } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js";
import { fauxSession } from "./helpers/faux-session.js";

const ROOT = join(import.meta.dirname, "..");
const PACKAGE_EXTENSIONS: string[] = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).pi.extensions;

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
let temp: string;
let loaded: Awaited<ReturnType<typeof loadExtensions>>;

beforeAll(async () => {
	temp = mkdtempSync(join(tmpdir(), "apple-pi-prompt-sections-"));
	process.env.PI_CODING_AGENT_DIR = join(temp, "agent");
	loaded = await loadExtensions(
		PACKAGE_EXTENSIONS.map((path) => join(ROOT, path)),
		ROOT,
		createEventBus(),
		createExtensionRuntime(),
	);
}, 30_000);

afterAll(() => {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(temp, { recursive: true, force: true });
});

async function runBeforeAgentStart(cwd: string, options: Partial<BuildSystemPromptOptions> = {}) {
	expect(loaded.errors).toEqual([]);
	const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, cwd, SessionManager.inMemory(cwd), {
		getAll: () => [],
		find: () => undefined,
	} as never);
	const { systemPromptOptions } = await runner.emitBeforeAgentStart(
		{ messageType: "user", prompt: "hello" },
		{ cwd, ...options },
	);
	return systemPromptOptions;
}

describe("package system prompt", () => {
	it("appends section changes and removals without rewriting the earlier provider request", async () => {
		let sections: Record<string, string> = { org: "Original manager", "role-catalog": "Original catalog" };
		const run = await fauxSession(
			[
				(pi) => {
					pi.on("before_agent_start", (event) => {
						for (const [name, content] of Object.entries(sections))
							setSystemPromptSection(event.systemPromptOptions, name, content);
					});
				},
			],
			() => fauxAssistantMessage("ok"),
			[],
		);
		try {
			await run.session.prompt("first");
			const prefix = run.requests.at(-1)!.messages;
			sections = { org: "Current manager" };
			await run.session.prompt("second");
			const updated = run.requests.at(-1)!.messages;
			expect(updated.slice(0, prefix.length)).toEqual(prefix);
			expect(updated.slice(prefix.length)).toContainEqual(
				expect.objectContaining({
					role: "system",
					sections: { org: "<org>\nCurrent manager\n</org>", "role-catalog": null },
				}),
			);
			await run.session.prompt("unchanged");
			expect(run.requests.at(-1)!.messages.filter((message) => message.role === "system")).toEqual(
				updated.filter((message) => message.role === "system"),
			);
		} finally {
			run.dispose();
		}
	});
	it("adds structured sections without an opaque prompt or a subagent catalog", async () => {
		const options = await runBeforeAgentStart(ROOT);
		expect(options.forceSystemPrompt).toBeUndefined();
		expect(Object.keys(options.sections)).toEqual(expect.arrayContaining(["pair-protocol", "ledger-workbench"]));
		expect(options.sections["subagent-team"]).toBeUndefined();
		expect(options.sections["inference-profiles"]).toBeUndefined();
		expect(buildSystemPrompt(options).match(/<ledger-workbench>/g)).toHaveLength(1);
	});

	it("adds the wiki workbench only to a project that has a wiki", async () => {
		const withoutWiki = join(temp, "plain");
		const withWiki = join(temp, "wiki");
		mkdirSync(withoutWiki, { recursive: true });
		mkdirSync(join(withWiki, ".wiki"), { recursive: true });
		expect((await runBeforeAgentStart(withoutWiki)).sections["wiki-workbench"]).toBeUndefined();
		expect((await runBeforeAgentStart(withWiki)).sections["wiki-workbench"]).toContain("wiki_lint");
	});

	it("does not repeat the ledger contract already supplied in a custom prompt", async () => {
		const customPrompt = buildSystemPrompt(await runBeforeAgentStart(ROOT));
		const options = await runBeforeAgentStart(ROOT, { customPrompt });
		expect(options.sections["ledger-workbench"]).toBeUndefined();
		expect(buildSystemPrompt(options).match(/<ledger-workbench>/g)).toHaveLength(1);
	});
});
