import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import piExec from "../../../extensions/pi-exec.js";
import { startFork } from "../../shared/src/forked-continuation.js";
import installCodeContext from "../src/index.js";

const CONTEXT_FILE = "## file\n\nInvariant: value stays a number.\n";
const EDIT = { path: "app.ts", edits: [{ oldText: "value = 1", newText: "value = 2" }] };

const sessions: Array<{ dispose(): void }> = [];
afterEach(() => {
	for (const session of sessions.splice(0)) session.dispose();
});

function call(name: string, args: Parameters<typeof fauxToolCall>[1], id: string): Reply {
	return fauxAssistantMessage(fauxToolCall(name, args, { id }), { stopReason: "toolUse" });
}

function resultText(messages: readonly AgentMessage[], id: string): { text: string; isError: boolean } {
	const result = messages.find((message) => message.role === "toolResult" && message.toolCallId === id);
	if (result?.role !== "toolResult") throw new Error(`no result for ${id}`);
	return {
		text: result.content.map((block) => (block.type === "text" ? block.text : "")).join("\n"),
		isError: result.isError,
	};
}

async function session(replies: Reply[], extensions = [installCodeContext]) {
	const faux = await fauxSession(extensions, replies, ["read", "edit", "write", "pi_exec"]);
	sessions.push(faux);
	mkdirSync(join(faux.cwd, ".context"));
	writeFileSync(join(faux.cwd, ".context/app.ts.md"), CONTEXT_FILE);
	const text = (id: string) => resultText(faux.session.messages, id);
	return { ...faux, replies, text };
}

describe("code context files", () => {
	it("delivers the whole context file once on a windowed read and then unlocks edits", async () => {
		const faux = await session([
			call("edit", EDIT, "edit-before"),
			call("read", { path: "app.ts", offset: 1, limit: 1 }, "read-1"),
			call("read", { path: "app.ts" }, "read-2"),
			call("edit", EDIT, "edit-after"),
		]);
		await faux.session.prompt("change value");

		const blocked = faux.text("edit-before");
		expect(blocked.isError).toBe(true);
		expect(blocked.text).toContain("Context Gate Blocked: Cannot modify `app.ts`");
		expect(blocked.text).toContain("Call `read` on `.context/app.ts.md` (or `app.ts`)");
		expect(blocked.text).not.toContain("value stays a number");

		const first = faux.text("read-1").text;
		expect(first).toContain("--- CONTEXT: .context/app.ts.md ---\n## file\n\nInvariant: value stays a number.");
		expect(first).toMatch(/<context-ref path="app\.ts" hash="sha256:[0-9a-f]{64}" \/>$/);
		expect(faux.text("read-2").text).not.toContain("CONTEXT");

		expect(faux.text("edit-after").isError).toBe(false);
		expect(readFileSync(join(faux.cwd, "app.ts"), "utf8")).toContain("value = 2");
	});

	it("invalidates a delivered marker when the context file changes on disk", async () => {
		let faux: Awaited<ReturnType<typeof session>> | undefined;
		faux = await session([
			call("read", { path: "app.ts" }, "read-1"),
			fauxAssistantMessage(fauxToolCall("write", { path: "notes.md", content: "x" }, { id: "touch" }), {
				stopReason: "toolUse",
			}),
			call("edit", EDIT, "edit-stale"),
			call("read", { path: "app.ts" }, "read-2"),
			call("edit", EDIT, "edit-fresh"),
		]);
		faux.session.subscribe((event) => {
			if (event.type === "tool_execution_end" && event.toolCallId === "touch" && faux)
				writeFileSync(join(faux.cwd, ".context/app.ts.md"), `${CONTEXT_FILE}\nHazard: new.\n`);
		});
		await faux.session.prompt("change value");

		expect(faux.text("edit-stale").text).toContain("Context Gate Blocked");
		expect(faux.text("read-2").text).toContain("Hazard: new.");
		expect(faux.text("edit-fresh").isError).toBe(false);
	});

	it("unlocks edits from a direct context file read and re-marks the context file after its own edit", async () => {
		const faux = await session([
			call("read", { path: ".context/app.ts.md" }, "read-context-file"),
			call(
				"edit",
				{ path: ".context/app.ts.md", edits: [{ oldText: "a number", newText: "an integer" }] },
				"edit-context-file",
			),
			call("edit", EDIT, "edit-source"),
		]);
		await faux.session.prompt("change value");

		const read = faux.text("read-context-file").text;
		expect(read).not.toContain("--- CONTEXT");
		expect(read).toMatch(/value stays a number\.[\s\S]*<context-ref path="app\.ts" hash="sha256:/);
		const edited = faux.text("edit-context-file");
		expect(edited.isError).toBe(false);
		expect(edited.text).toMatch(/<context-ref path="app\.ts" hash="sha256:[0-9a-f]{64}" \/>$/);
		expect(faux.text("edit-source").isError).toBe(false);
	});

	it("leaves files without a context file and unreadable context files ungated", async () => {
		const faux = await session([
			call("write", { path: "free.ts", content: "free\n" }, "write-free"),
			call("edit", EDIT, "edit-empty"),
			call("read", { path: "app.ts" }, "read-empty"),
		]);
		writeFileSync(join(faux.cwd, ".context/app.ts.md"), "  \r\n");
		await faux.session.prompt("change value");

		expect(faux.text("write-free").isError).toBe(false);
		expect(faux.text("edit-empty").isError).toBe(false);
		expect(faux.text("read-empty").text).toContain(".context/app.ts.md could not be loaded because it is empty");
	});

	it("returns raw file content to pi_exec programs and does not gate their mutations", async () => {
		const faux = await session(
			[
				call(
					"pi_exec",
					{
						code: 'text = await read(path="app.ts")\nawait edit(path="app.ts", edits=[{"oldText": "value = 1", "newText": "value = 3"}])\ntext',
					},
					"exec",
				),
			],
			[installCodeContext, piExec],
		);
		await faux.session.prompt("run it");

		const result = faux.text("exec");
		expect(result.isError).toBe(false);
		expect(result.text).toContain("export const value = 1;");
		expect(result.text).not.toContain("context-ref");
		expect(readFileSync(join(faux.cwd, "app.ts"), "utf8")).toContain("value = 3");
	}, 30_000);

	it("keeps a delivered marker live across prompts until compaction removes it", async () => {
		const faux = await session([call("read", { path: "app.ts" }, "read-1"), fauxAssistantMessage("read it")]);
		faux.session.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
		await faux.session.prompt("look");
		faux.replies.push(call("edit", EDIT, "edit-next-prompt"), fauxAssistantMessage("ok"));
		await faux.session.prompt("change value");
		expect(faux.text("edit-next-prompt").isError).toBe(false);

		faux.replies.push(fauxAssistantMessage("summary"));
		await faux.session.compact();
		expect(JSON.stringify(faux.session.sessionManager.buildSessionProjection().messages)).not.toContain("context-ref");
		faux.replies.push(
			call("edit", { path: "app.ts", edits: [{ oldText: "value = 2", newText: "value = 3" }] }, "edit-compacted"),
			fauxAssistantMessage("done"),
		);
		await faux.session.prompt("change it again");
		expect(faux.text("edit-compacted").text).toContain("Context Gate Blocked");
		expect(readFileSync(join(faux.cwd, "app.ts"), "utf8")).toContain("value = 2");
	});

	it("evaluates a fork's own conversation, not the parent session's", async () => {
		const faux = await session([fauxAssistantMessage("settled")]);
		await faux.session.prompt("hello");
		faux.replies.push(
			call("edit", EDIT, "fork-edit-before"),
			call("read", { path: "app.ts" }, "fork-read"),
			call("edit", EDIT, "fork-edit-after"),
			fauxAssistantMessage("fork done"),
		);
		const { messages } = await startFork(faux.session, {
			messages: faux.session.sessionManager.buildSessionProjection().messages,
			append: { role: "custom", customType: "test", content: "fork", display: false, timestamp: Date.now() },
			label: "fork test",
		}).result;

		expect(resultText(messages, "fork-edit-before").text).toContain("Context Gate Blocked");
		expect(resultText(messages, "fork-read").text).toContain("--- CONTEXT: .context/app.ts.md ---");
		expect(resultText(messages, "fork-edit-after").isError).toBe(false);
	});
});
