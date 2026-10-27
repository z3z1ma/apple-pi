import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context, Model } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { SessionManager, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { expect, test, vi } from "vitest";
import { fauxModelBackend } from "../../../tests/helpers/faux-model.js";
import { SET_PAIR_ATTENTION_TOOL_NAME } from "../src/review-scheduler.js";
import { createPairSession } from "../src/session.js";

function tool(name: string): ToolDefinition {
	return {
		name,
		label: name,
		description: name,
		parameters: Type.Object({}),
		async execute() {
			return { content: [{ type: "text", text: "unused" }], details: {} };
		},
	};
}

test("the private pair session uses Pi's native LLM summary and retains its recent conversation", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pair-native-compaction-"));
	vi.stubEnv("PI_CODING_AGENT_DIR", join(cwd, "agent"));
	const model: Model<string> = {
		id: "pair-native-test",
		name: "Pair native test",
		api: "test-pair-native-api",
		provider: "test-pair-native-provider",
		baseUrl: "https://pair.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 10_000,
	};
	const requests: Context[] = [];
	const models: string[] = [];
	const stream = (selected: Model<string>, context: Context) => {
		models.push(selected.id);
		requests.push(structuredClone(context));
		const message = fauxAssistantMessage(
			requests.length <= 2 ? `review complete ${requests.length}` : "NATIVE_PAIR_SUMMARY",
		);
		const events = createAssistantMessageEventStream();
		events.push({ type: "done", reason: "stop", message });
		events.end(message);
		return events;
	};
	const { modelRuntime } = fauxModelBackend(model);
	let session: Awaited<ReturnType<typeof createPairSession>> | undefined;
	try {
		session = await createPairSession({
			cwd,
			model,
			systemPrompt: "Review the driver's work.",
			adviseTool: tool("share_note"),
			secondOpinionTool: tool("ask_for_second_opinion"),
			directoryTool: tool("directory"),
			receiptTool: tool("expand_receipt"),
			attentionTool: tool(SET_PAIR_ATTENTION_TOOL_NAME),
			primarySessionManager: SessionManager.inMemory(cwd),
			modelRuntime: { ...modelRuntime, stream, streamSimple: stream },
		});
		session.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
		await session.prompt("OLDER_PAIR_TRAJECTORY: inspect the auth implementation. ".repeat(30));
		await session.prompt("CURRENT_PAIR_FRONTIER: verify the refresh fix.");
		const result = await session.compact();

		expect(requests.length).toBeGreaterThan(2);
		expect(models.every((id) => id === model.id)).toBe(true);
		expect(JSON.stringify(requests.slice(2))).toContain("OLDER_PAIR_TRAJECTORY");
		expect(result.summary).toContain("NATIVE_PAIR_SUMMARY");
		const entry = session.sessionManager.getEntries().findLast((item) => item.type === "compaction");
		expect(entry).toMatchObject({ type: "compaction", fromHook: false });
		expect(entry).not.toHaveProperty("details.serverCompaction");
		const projected = session.sessionManager.buildSessionProjection().messages;
		expect(projected.some((message) => message.role === "compactionSummary")).toBe(true);
		expect(JSON.stringify(projected.filter((message) => message.role === "assistant"))).toContain("review complete 2");
	} finally {
		session?.dispose();
		vi.unstubAllEnvs();
		rmSync(cwd, { recursive: true, force: true });
	}
});
