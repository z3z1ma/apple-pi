import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import {
	LEARNING_DISTILLATION_MESSAGE_TYPE,
	LEARNING_REFLECTION_MESSAGE_TYPE,
	LEARNING_REFLECTION_SPACING_TOKENS,
	registerLearningCycle,
} from "../src/hooks/learning-cycle.js";
import { registerMainNotebookTool } from "../src/notebook-maintenance.js";
import { Runtime } from "../src/runtime.js";
import { type Entry, foldLedger } from "../src/session-ledger/index.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose();
});

function tool(name: string, args: Parameters<typeof fauxToolCall>[1], id: string): Reply {
	return fauxAssistantMessage(fauxToolCall(name, args, { id }), { stopReason: "toolUse" });
}

function spending(text: string, tokens: number): Reply {
	const reply = fauxAssistantMessage(text);
	reply.usage.input = tokens;
	return reply;
}

async function harness(replies: Parameters<typeof fauxSession>[1]) {
	const run = await fauxSession(
		[
			(pi) => {
				registerMainNotebookTool(pi, new Runtime());
				registerLearningCycle(pi);
			},
		],
		replies,
		["bash", "update_notebook"],
	);
	cleanup.push(run.dispose);
	run.session.settingsManager.applyOverrides({ compaction: { enabled: false, keepRecentTokens: 1 } });
	const reflections = () => run.customMessages(LEARNING_REFLECTION_MESSAGE_TYPE);
	const distillations = () => run.customMessages(LEARNING_DISTILLATION_MESSAGE_TYPE);
	const learnings = () => foldLedger(run.session.sessionManager.getBranch() as Entry[]).currentReflections;
	return { ...run, reflections, distillations, learnings };
}

describe("learning reflection", () => {
	it("journals in a fork once enough tokens pass, with failed calls as evidence", async () => {
		const { session, requests, reflections, learnings } = await harness([
			tool("bash", { command: "exit 3" }, "bash-1"),
			spending("done", LEARNING_REFLECTION_SPACING_TOKENS),
			tool(
				"update_notebook",
				{ reflections: [{ content: "exit 3 means the profile is missing." }], retireReflectionIds: [] },
				"fork-note",
			),
			fauxAssistantMessage("Recorded one learning."),
		]);

		await session.prompt("Check the bucket.");
		await vi.waitFor(() => expect(reflections()).toHaveLength(1));

		expect(JSON.stringify(requests[2]?.messages.at(-1))).toContain(
			"Failed or surprising tool calls since the last reflection:\\n- bash: `exit 3`",
		);
		expect(learnings().map((learning) => learning.content)).toEqual(["exit 3 means the profile is missing."]);
		expect(reflections()[0]).toMatchObject({ content: "Reflection: Recorded one learning." });
	});

	it("asks the reflection only to capture", async () => {
		const { session, requests, reflections } = await harness([
			spending("done", LEARNING_REFLECTION_SPACING_TOKENS),
			fauxAssistantMessage("Nothing worth keeping."),
		]);

		await session.prompt("Hello.");
		await vi.waitFor(() => expect(reflections()).toHaveLength(1));

		const prompt = JSON.stringify(requests[1]?.messages.at(-1));
		expect(prompt).toContain("Record each learning with `update_notebook`");
		expect(prompt).not.toContain("LEARNINGS.md");
	});

	it("waits until enough new tokens have passed", async () => {
		const { session, requests, reflections } = await harness([
			spending("done", LEARNING_REFLECTION_SPACING_TOKENS - 1),
		]);

		await session.prompt("Hello.");
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(requests).toHaveLength(1);
		expect(reflections()).toHaveLength(0);
	});
});

function captureExtension() {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const commands = new Map<string, { handler: () => Promise<void> }>();
	const sent: Array<{ message: { content: string }; options: unknown }> = [];
	const pi = {
		on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => handlers.set(event, handler),
		registerCommand: (name: string, command: { handler: () => Promise<void> }) => commands.set(name, command),
		registerMessageRenderer: () => {},
		sendMessage: (message: { content: string }, options: unknown) => sent.push({ message, options }),
	} as unknown as ExtensionAPI;
	registerLearningCycle(pi);
	const run = (command: string, isError: boolean, expect?: "success" | "failure", surprise?: boolean) =>
		handlers.get("tool_result")?.(
			{ isError, toolName: "bash", input: { command, expect }, details: { surprise } },
			{ sessionManager: { getSessionId: () => "primary-fixture" } },
		);
	const reflect = async () => {
		await commands.get("reflect")?.handler();
		return sent.at(-1);
	};
	return { run, reflect };
}

const lastText = (context: Context) => JSON.stringify(context.messages.at(-1));

describe("learning distillation", () => {
	it("distills every open learning in a fork right after compaction", async () => {
		let noted = false;
		const { session, requests, distillations, learnings } = await harness((context) => {
			const text = lastText(context);
			if (text.includes("Distill the open learnings")) return fauxAssistantMessage("Placed one learning.");
			if (!noted) {
				noted = true;
				return tool("update_notebook", { reflections: [{ content: "Use perl -pi -e for edits." }] }, "note-1");
			}
			return fauxAssistantMessage("done");
		});

		await session.prompt("Edit the file.");
		const [learning] = learnings();
		await session.compact();
		await vi.waitFor(() => expect(distillations()).toHaveLength(1));

		const prompt = requests.map(lastText).find((text) => text.includes("Distill the open learnings"));
		expect(prompt).toContain(`[${learning?.id}] Use perl -pi -e for edits.`);
		expect(distillations()[0]).toMatchObject({ content: "Distill: Placed one learning." });
	});

	it("runs nothing after compaction when no learnings are open", async () => {
		const { session, requests, distillations } = await harness([
			fauxAssistantMessage("done"),
			fauxAssistantMessage("Summary."),
		]);

		await session.prompt("Hello.");
		await session.compact();
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(requests).toHaveLength(2);
		expect(distillations()).toHaveLength(0);
	});

	it("starts a distill only after a running reflection settles", async () => {
		let releaseReflection: (reply: Reply) => void = () => {};
		let noted = false;
		const { session, requests, reflections, distillations } = await harness((context) => {
			const text = lastText(context);
			if (text.includes("Reflect on what you learned"))
				return new Promise<Reply>((resolve) => {
					releaseReflection = resolve;
				});
			if (text.includes("Distill the open learnings")) return fauxAssistantMessage("Retired nothing.");
			if (!noted) {
				noted = true;
				return tool("update_notebook", { reflections: [{ content: "Use perl -pi -e for edits." }] }, "note-1");
			}
			return spending("done", LEARNING_REFLECTION_SPACING_TOKENS);
		});

		await session.prompt("Edit the file.");
		await vi.waitFor(() => expect(requests.some((request) => lastText(request).includes("Reflect on"))).toBe(true));
		await session.compact();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(requests.some((request) => lastText(request).includes("Distill the open"))).toBe(false);

		releaseReflection(fauxAssistantMessage("Recorded nothing new."));
		await vi.waitFor(() => expect(distillations()).toHaveLength(1));
		expect(reflections()).toHaveLength(1);
	});
});

describe("/reflect", () => {
	it("asks in-band to journal", async () => {
		const { reflect } = captureExtension();
		const sent = await reflect();
		expect(sent?.message.content).toContain("Record each learning with `update_notebook`");
		expect(sent?.options).toEqual({ deliverAs: "steer", triggerTurn: true });
	});

	it("drops predicted failures and keeps unpredicted successes as evidence", async () => {
		const { run, reflect } = captureExtension();
		run("aws s3 ls\n--profile dev", true);
		run("aws s3 ls\n--profile dev", true);
		run("npm test -- red", true, "failure");
		run("npm test -- green", false, "failure", true);
		run("npm run watch", false, "failure");
		const content = (await reflect())?.message.content ?? "";
		expect(content.match(/aws s3 ls/g)).toHaveLength(1);
		expect(content).not.toContain("-- red");
		expect(content).toContain("- bash: `npm test -- green` succeeded; you predicted failure");
		expect(content).not.toContain("watch");
		expect((await reflect())?.message.content).not.toContain("Failed or surprising");
	});
});
