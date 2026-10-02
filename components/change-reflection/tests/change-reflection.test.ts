import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context, Model } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { CHANGE_REFLECTION_EXTENSION_PATH } from "../../../extensions/change-reflection.js";
import { fauxModelBackend } from "../../../tests/helpers/faux-model.js";
import { CHANGE_REFLECTION_MESSAGE_TYPE, reflectionPrompt } from "../src/index.js";

type Reply = ReturnType<typeof fauxAssistantMessage>;

const model = {
	id: "reflection-model",
	name: "Reflection model",
	api: "test-reflection-api",
	provider: "reflection-provider",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 10_000,
} as Model<string>;

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose();
});

function tool(name: string, args: Parameters<typeof fauxToolCall>[1], id: string): Reply {
	return fauxAssistantMessage(fauxToolCall(name, args, { id }), { stopReason: "toolUse" });
}

async function harness(replies: Reply[]) {
	const cwd = mkdtempSync(join(tmpdir(), "apple-pi-reflection-"));
	mkdirSync(join(cwd, "agent"));
	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	const requests: Context[] = [];
	const stream = (_model: Model<string>, context: Context) => {
		requests.push(structuredClone(context));
		const message = replies.shift() ?? fauxAssistantMessage("done");
		const stream = createAssistantMessageEventStream();
		stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
		stream.end(message);
		return stream;
	};
	const { modelRuntime } = fauxModelBackend(model);
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: join(cwd, "agent"),
		additionalExtensionPaths: [CHANGE_REFLECTION_EXTENSION_PATH],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPromptOverride: () => "test",
		appendSystemPromptOverride: () => [],
	});
	await loader.reload();
	const { session } = await createAgentSession({
		cwd,
		model,
		modelRuntime: { ...modelRuntime, stream, streamSimple: stream } as never,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(cwd),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
	});
	await session.bindExtensions({});
	session.setActiveToolsByName(["read", "edit", "write"]);
	cleanup.push(() => {
		session.dispose();
		rmSync(cwd, { recursive: true, force: true });
	});
	const reflections = () =>
		session.messages.filter(
			(message) => message.role === "custom" && message.customType === CHANGE_REFLECTION_MESSAGE_TYPE,
		);
	return { session, requests, reflections };
}

describe("change reflection", () => {
	it("asks once per settled run with lenses matched to the changed files", async () => {
		const { session, requests, reflections } = await harness([
			tool("write", { path: "README.md", content: "# App\n" }, "write-1"),
			tool("edit", { path: "app.ts", edits: [{ oldText: "1", newText: "2" }] }, "edit-1"),
			fauxAssistantMessage("implemented"),
			tool("edit", { path: "app.ts", edits: [{ oldText: "2", newText: "3" }] }, "edit-2"),
			fauxAssistantMessage("simplified"),
		]);

		await session.prompt("Implement it.");

		expect(requests).toHaveLength(5);
		expect(reflections()).toHaveLength(1);
		expect(reflections()[0]).toMatchObject({ content: reflectionPrompt(["README.md", "app.ts"]) });
		const last = session.messages.at(-1);
		expect(last?.role === "assistant" && JSON.stringify(last.content)).toContain("simplified");
	});

	it("asks again for edits made in a later user request", async () => {
		const { session, reflections } = await harness([
			tool("write", { path: "notes.md", content: "a\n" }, "write-1"),
			fauxAssistantMessage("first"),
			fauxAssistantMessage("first reviewed"),
			tool("write", { path: "notes.md", content: "b\n" }, "write-2"),
			fauxAssistantMessage("second"),
			fauxAssistantMessage("second reviewed"),
		]);

		await session.prompt("First.");
		await session.prompt("Second.");

		expect(reflections()).toHaveLength(2);
	});

	it("stays quiet without a successful edit or write", async () => {
		const { session, requests, reflections } = await harness([
			tool("read", { path: "app.ts" }, "read-1"),
			tool("edit", { path: "missing.ts", edits: [{ oldText: "a", newText: "b" }] }, "edit-1"),
			fauxAssistantMessage("nothing changed"),
		]);

		await session.prompt("Look around.");

		expect(requests).toHaveLength(3);
		expect(reflections()).toHaveLength(0);
	});
});

describe("reflectionPrompt", () => {
	it("uses only the lens that applies", () => {
		expect(reflectionPrompt(["src/a.ts"])).toContain("simpler way");
		expect(reflectionPrompt(["src/a.ts"])).not.toContain("intended reader");
		expect(reflectionPrompt(["docs/a.md"])).toContain("intended reader");
		expect(reflectionPrompt(["docs/a.md"])).not.toContain("simpler way");
	});
});
