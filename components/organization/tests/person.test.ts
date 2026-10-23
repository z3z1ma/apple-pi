import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, expect, test, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import { installOrganization, SELF_REFLECTION_MESSAGE_TYPE } from "../src/index.js";

vi.stubEnv("PI_CODING_AGENT_DIR", mkdtempSync(join(tmpdir(), "apo-agent-")));

const cleanup: (() => void)[] = [];
afterEach(() => {
	vi.unstubAllGlobals();
	for (const dispose of cleanup.splice(0)) dispose();
});

const organization = (pi: ExtensionAPI) => {
	pi.registerFlag("role", { type: "string", description: "role" });
	pi.registerFlag("reports-to", { type: "string", description: "manager" });
	installOrganization(pi);
	// The session-state work tools own `finish_task`; reflection only needs its name.
	pi.registerTool(
		defineTool({
			name: "finish_task",
			label: "finish_task",
			description: "Finish the focused task.",
			parameters: Type.Object({ outcome: Type.String() }),
			execute: async () => ({ content: [{ type: "text", text: "Finished." }], details: {} }),
		}),
	);
};

const tool = (name: string, args: Parameters<typeof fauxToolCall>[1]): Reply =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const lastText = (context: Context) => JSON.stringify(context.messages.at(-1));
const selfSection = (prompt: string) => /<self>\n([\s\S]*?)\n<\/self>/.exec(prompt)?.[1];

async function person(replies: Parameters<typeof fauxSession>[1], role?: string) {
	const run = await fauxSession([organization], replies, ["read", "finish_task", "update_self"]);
	cleanup.push(run.dispose);
	run.session.settingsManager.applyOverrides({ compaction: { enabled: false, keepRecentTokens: 1 } });
	if (role) run.session.extensionRunner.setFlagValue("role", role);
	await run.session.bindExtensions({});
	return { ...run, prompt: () => run.session.agent.state.systemPrompt };
}

test("two people hired into the same role share the role body and differ by the fragments of their souls", async () => {
	const prompts: string[] = [];
	for (let i = 0; i < 2; i++) {
		const run = await person([fauxAssistantMessage("ok")], "staff-engineer-simplicity");
		await run.session.prompt("hi");
		prompts.push(run.prompt());
	}
	const [a, b] = prompts as [string, string];
	expect(a).toContain("<role>\nYou are a Staff Software Engineer");
	expect(a).toMatch(
		/Your soul: fragments of the world[^\n]+\n\n- \*\*Article \d+\*\* \(Fake article\): Fact number \d+\./,
	);
	const soulOf = (prompt: string) => prompt.match(/\*\*Article \d+\*\*/g);
	expect(soulOf(a)).toHaveLength(3);
	expect(soulOf(a)).not.toEqual(soulOf(b));
});

test("a failed draw leaves the person without a soul until a later start draws one", async () => {
	vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
	const run = await person([fauxAssistantMessage("ok"), fauxAssistantMessage("ok")], "staff-engineer-simplicity");
	await run.session.prompt("hi");
	expect(run.prompt()).toContain("<role>\nYou are a Staff Software Engineer");
	expect(run.prompt()).not.toContain("Your soul:");

	vi.unstubAllGlobals();
	await run.session.bindExtensions({}); // a later start
	await run.session.prompt("again");
	expect(run.prompt()).toContain("Your soul:");
});

test("the main conversation cannot rewrite its self", async () => {
	const run = await person([tool("update_self", { story: "I decided who I am." }), fauxAssistantMessage("done")]);
	await run.session.prompt("Rewrite yourself.");
	const result = run.session.agent.state.messages.find((message) => message.role === "toolResult");
	expect(result).toMatchObject({ isError: true });
	expect(JSON.stringify(result)).toContain("rewritten only in reflection");
	expect(selfSection(run.prompt())).toContain("You have not written your self yet.");
});

test("finishing a task starts a reflection whose self joins the conversation now and the system prompt at compaction", async () => {
	const self = {
		story: "I came to this from three facts nobody explained.",
		practice: "Nothing seen from outside yet.",
		commitments: "I say what I have not checked.",
	};
	let reflected = false;
	const run = await person((context) => {
		const text = lastText(context);
		if (text.includes("<conversation>")) return fauxAssistantMessage("The summary.");
		if (JSON.stringify(context.messages).includes("You have finished a task.")) {
			if (reflected) return fauxAssistantMessage("Wrote my first self.");
			reflected = true;
			return tool("update_self", self);
		}
		if (text.includes("Close the task.")) return tool("finish_task", { outcome: "done" });
		return fauxAssistantMessage("ok");
	}, "staff-engineer-simplicity");

	await run.session.prompt("Close the task.");
	await vi.waitFor(() => expect(run.customMessages(SELF_REFLECTION_MESSAGE_TYPE)).toHaveLength(1));

	const reflection = run.requests.find((request) => lastText(request).includes("You have finished a task."));
	expect(lastText(reflection as Context)).toContain("this is its first version");
	const content = JSON.stringify(run.customMessages(SELF_REFLECTION_MESSAGE_TYPE)[0]);
	expect(content).toContain('"content":"Self: Wrote my first self.');
	expect(JSON.parse(content).content).toContain(`## What I hold myself to\n${self.commitments}`);

	// The prompt prefix holds: the system prompt keeps its self until the compaction rebuilds the context.
	await run.session.prompt("Next.");
	expect(selfSection(run.prompt())).toContain("You have not written your self yet.");
	await run.session.compact();
	await run.session.prompt("After compaction.");
	expect(selfSection(run.prompt())).toBe(
		`## My story\n${self.story}\n\n## How I work\n${self.practice}\n\n## What I hold myself to\n${self.commitments}`,
	);
});

test("a reflection before compaction sees the conversation the compaction is about to remove, and may keep the self", async () => {
	const run = await person((context) => {
		const text = lastText(context);
		if (text.includes("about to be compacted")) return fauxAssistantMessage("Nothing changed what I think of myself.");
		return fauxAssistantMessage("ok");
	});

	await run.session.prompt("A detail only this context holds.");
	await run.session.compact();
	await vi.waitFor(() =>
		expect(run.requests.some((request) => lastText(request).includes("about to be compacted"))).toBe(true),
	);
	const reflection = run.requests.find((request) => lastText(request).includes("about to be compacted")) as Context;
	expect(JSON.stringify(reflection.messages)).toContain("A detail only this context holds.");
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(run.customMessages(SELF_REFLECTION_MESSAGE_TYPE)).toHaveLength(0);
});
