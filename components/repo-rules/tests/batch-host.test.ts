import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolCall } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { expect, test } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { startFork } from "../../shared/src/forked-continuation.js";
import { installRepoRules } from "../src/index.js";

const call = (id: string, name: string, args: ToolCall["arguments"]) => ({
	type: "toolCall" as const,
	id,
	name,
	arguments: args,
});
const withRules = (cwd: string) =>
	cpSync(join(import.meta.dirname, "../../../.pi/rules"), join(cwd, ".pi/rules"), { recursive: true });
const reply = (...calls: ReturnType<typeof call>[]) => ({
	...fauxAssistantMessage(""),
	content: calls,
	stopReason: "toolUse" as const,
});

test("real host keeps unrelated tools usable beside an invalid writer", async () => {
	const f = await fauxSession(
		[installRepoRules],
		[
			reply(
				call("bad", "write", { path: "file://other-host/a.ts", content: "x" }),
				call("good", "read", { path: "app.ts" }),
				call("shell", "bash", { command: "printf independent" }),
			),
		],
		["write", "read", "bash"],
	);
	try {
		await f.session.prompt("Run the scripted batch");
		const results = f.session.messages.filter((m) => m.role === "toolResult");
		expect(results.find((m) => m.toolCallId === "bad")?.isError).toBe(true);
		expect(results.find((m) => m.toolCallId === "good")?.isError).toBe(false);
		expect(results.find((m) => m.toolCallId === "shell")?.isError).toBe(false);
	} finally {
		f.dispose();
	}
});

test("finalized message replacements, not intermediate message_end values, define the batch", async () => {
	const transform = (pi: Parameters<typeof installRepoRules>[0]) =>
		pi.on("message_end", (event) => {
			const message = event.message;
			if (message.role === "assistant" && message.content.some((c) => c.type === "toolCall" && c.id === "write"))
				return { message: { ...message, content: [...message.content, call("added", "read", { path: "app.ts" })] } };
		});
	const f = await fauxSession(
		[installRepoRules, transform],
		[reply(call("write", "write", { path: "app.ts", content: "new" }))],
		["write", "read"],
	);
	try {
		withRules(f.cwd);
		await f.session.prompt("Run the transformed batch");
		const result = f.session.messages.find((m) => m.role === "toolResult" && m.toolCallId === "added");
		expect(result).toMatchObject({ isError: true });
		expect(readFileSync(join(f.cwd, "app.ts"), "utf8")).toBe("new");
	} finally {
		f.dispose();
	}
});

test("a real fork inspects its own batch and a later parent read remains independent", async () => {
	const f = await fauxSession(
		[installRepoRules],
		[
			fauxAssistantMessage("parent settled"),
			reply(
				call("writer", "write", { path: "app.ts", content: "fork edit" }),
				call("reader", "read", { path: "app.ts" }),
			),
			fauxAssistantMessage("fork settled"),
			reply(call("reader", "read", { path: "app.ts" })),
		],
		["write", "read"],
	);
	try {
		withRules(f.cwd);
		await f.session.prompt("Settle the parent");
		const fork = await startFork(f.session, {
			messages: structuredClone(f.session.sessionManager.buildSessionProjection().messages),
			append: {
				role: "custom",
				customType: "batch-test",
				content: "Run the fork batch",
				display: false,
				timestamp: Date.now(),
			},
			label: "batch test",
			recordUsage: false,
		}).result;
		expect(fork.messages.find((m) => m.role === "toolResult" && m.toolCallId === "reader")).toMatchObject({
			isError: true,
		});
		expect(readFileSync(join(f.cwd, "app.ts"), "utf8")).toBe("fork edit");
		await f.session.prompt("Read from the parent after the fork");
		expect(f.session.messages.findLast((m) => m.role === "toolResult" && m.toolCallId === "reader")).toMatchObject({
			isError: false,
		});
	} finally {
		f.dispose();
	}
});

test("host checks are refused after a failed writer, and later messages may retry", async () => {
	const f = await fauxSession(
		[installRepoRules],
		[
			reply(
				call("edit", "edit", { path: "app.ts", edits: [{ oldText: "absent", newText: "new" }] }),
				call("read", "read", { path: "app.ts" }),
			),
			reply(call("later", "read", { path: "app.ts" })),
		],
		["edit", "read"],
	);
	try {
		withRules(f.cwd);
		await f.session.prompt("Run and retry");
		const results = f.session.messages.filter((m) => m.role === "toolResult");
		expect(results.find((m) => m.toolCallId === "edit")?.isError).toBe(true);
		expect(results.find((m) => m.toolCallId === "read")?.isError).toBe(true);
		expect(results.find((m) => m.toolCallId === "later")?.isError).toBe(false);
	} finally {
		f.dispose();
	}
});
