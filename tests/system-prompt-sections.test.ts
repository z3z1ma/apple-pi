import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type BuildSystemPromptOptions,
	createEventBus,
	createExtensionRuntime,
	ExtensionRunner,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadExtensions } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import { buildSystemPrompt } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js";
import { addToolGuidanceSections, buildAgentPrompt } from "../components/subagents/src/prompts.js";
import type { AgentConfig } from "../components/subagents/src/types.js";

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
	const { systemPromptOptions } = await runner.emitBeforeAgentStart("hello", undefined, { cwd, ...options });
	return systemPromptOptions;
}

describe("package system prompt", () => {
	it("adds structured sections without forcing an opaque prompt", async () => {
		const options = await runBeforeAgentStart(ROOT);
		expect(options.forceSystemPrompt).toBeUndefined();
		expect(Object.keys(options.sections)).toEqual(
			expect.arrayContaining(["pair-protocol", "subagent-team", "inference-profiles", "ledger-workbench"]),
		);
		const prompt = buildSystemPrompt(options);
		expect(prompt.match(/<ledger-workbench>/g)).toHaveLength(1);
	});

	it("adds the wiki workbench only to a project that has a wiki", async () => {
		const withoutWiki = join(temp, "plain");
		const withWiki = join(temp, "wiki");
		mkdirSync(withoutWiki, { recursive: true });
		mkdirSync(join(withWiki, ".wiki"), { recursive: true });
		expect((await runBeforeAgentStart(withoutWiki)).sections["wiki-workbench"]).toBeUndefined();
		expect((await runBeforeAgentStart(withWiki)).sections["wiki-workbench"]).toContain("wiki_lint");
	});

	it("does not repeat sections an append-mode child inherits from its parent prompt", async () => {
		const parentPrompt = buildSystemPrompt(await runBeforeAgentStart(ROOT));
		const config: AgentConfig = {
			name: "twin",
			description: "test",
			systemPrompt: "",
			extensions: false,
			skills: false,
			promptMode: "append",
		};
		const childPreamble = buildAgentPrompt(config, { isGitRepo: false, branch: "", platform: "test" }, parentPrompt);
		const child = await runBeforeAgentStart(ROOT, { customPrompt: childPreamble });
		expect(child.sections["ledger-workbench"]).toBeUndefined();
		expect(buildSystemPrompt(child).match(/<ledger-workbench>/g)).toHaveLength(1);
	});
});

describe("child tool guidance", () => {
	const base = {
		cwd: "/repo",
		selectedTools: ["read", "search_session"],
		toolSnippets: { read: "Read files", search_session: "Recover earlier conversation" },
		toolGuidelines: { search_session: ["Use search_session for earlier work."] },
		promptGuidelines: ["Use search_session for earlier work.", "Keep reports short."],
		appendSystemPrompt: "",
		contextFiles: [],
		skills: [],
	};

	it("renders tool summaries and deduplicated rules under a custom preamble", () => {
		const options = { ...base, customPrompt: "You are a teammate.", sections: {} };
		addToolGuidanceSections(options);
		expect(options.sections).toEqual({
			tools: "- read: Read files\n- search_session: Recover earlier conversation",
			rules: "- Use search_session for earlier work.\n- Keep reports short.",
		});
	});

	it("leaves Pi's default prompt and an inherited parent prompt unchanged", () => {
		const defaultPrompt = { ...base, sections: {} };
		addToolGuidanceSections(defaultPrompt);
		expect(defaultPrompt.sections).toEqual({});
		const inherited = {
			...base,
			customPrompt: "Parent\n\n<tools>\n- bash: Run\n</tools>\n\n<rules>\n- x\n</rules>",
			sections: {},
		};
		addToolGuidanceSections(inherited);
		expect(inherited.sections).toEqual({});
	});
});
