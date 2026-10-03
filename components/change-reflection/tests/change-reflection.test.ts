import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import registerChangeReflection, { CHANGE_REFLECTION_MESSAGE_TYPE, reflectionPrompt } from "../src/index.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose();
});

function tool(name: string, args: Parameters<typeof fauxToolCall>[1], id: string): Reply {
	return fauxAssistantMessage(fauxToolCall(name, args, { id }), { stopReason: "toolUse" });
}

async function harness(replies: Reply[]) {
	const run = await fauxSession([registerChangeReflection], replies, ["read", "edit", "write", "bash"]);
	cleanup.push(run.dispose);
	const reflections = () => run.customMessages(CHANGE_REFLECTION_MESSAGE_TYPE);
	return { ...run, reflections };
}

const lastText = (request: { messages: Array<{ content: unknown }> }) =>
	JSON.stringify(request.messages.at(-1)?.content);

describe("change reflection", () => {
	it("reflects in an identical fork and adds its reply as one passive message", async () => {
		const { session, requests, reflections } = await harness([
			tool("write", { path: "README.md", content: "# App\n" }, "write-1"),
			tool("edit", { path: "app.ts", edits: [{ oldText: "1", newText: "2" }] }, "edit-1"),
			fauxAssistantMessage("implemented"),
			fauxAssistantMessage("Kept the result; nothing simpler."),
		]);

		await session.prompt("Implement it.");
		await vi.waitFor(() => expect(reflections()).toHaveLength(1));

		expect(requests).toHaveLength(4);
		const [parent, fork] = [requests[2]!, requests[3]!];
		expect(parent.messages[0]).toMatchObject({ role: "system", toolsAdded: expect.any(Array) });
		expect(fork.messages.slice(0, parent.messages.length)).toEqual(parent.messages);
		expect(JSON.stringify(fork.messages[parent.messages.length]?.content)).toContain("implemented");
		expect(lastText(fork)).toContain(JSON.stringify(reflectionPrompt(["README.md", "app.ts"], new Map())).slice(1, -1));
		expect(reflections()[0]).toMatchObject({ content: "Change review: Kept the result; nothing simpler." });
		expect(session.messages.at(-1)).toBe(reflections()[0]);
		expect(
			session.sessionManager
				.getEntries()
				.filter((entry) => entry.type === "usage" && entry.kind === "forked_continuation"),
		).toHaveLength(1);
	});

	it("keeps the fork's edits and does not reflect on them again", async () => {
		const { cwd, session, requests, reflections } = await harness([
			tool("write", { path: "notes.md", content: "a\n" }, "write-1"),
			fauxAssistantMessage("first"),
			tool("edit", { path: "notes.md", edits: [{ oldText: "a", newText: "b" }] }, "fork-edit"),
			fauxAssistantMessage("Tightened notes.md."),
			fauxAssistantMessage("second"),
		]);

		await session.prompt("First.");
		await vi.waitFor(() => expect(reflections()).toHaveLength(1));
		expect(readFileSync(join(cwd, "notes.md"), "utf8")).toBe("b\n");

		await session.prompt("Second.");
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(requests).toHaveLength(5);
		expect(reflections()).toHaveLength(1);
		expect(JSON.stringify(requests[4]?.messages)).toContain("Change review: Tightened notes.md.");
	});

	it("lists what ran after each code path's last change", async () => {
		const { session, requests, reflections } = await harness([
			tool("write", { path: "lib.ts", content: "export {};\n" }, "write-1"),
			tool("bash", { command: "true" }, "bash-1"),
			tool("bash", { command: "false" }, "bash-2"),
			tool("bash", { command: "true", run_in_background: true }, "bash-3"),
			tool("edit", { path: "app.ts", edits: [{ oldText: "1", newText: "2" }] }, "edit-1"),
			fauxAssistantMessage("implemented"),
			fauxAssistantMessage("reviewed"),
		]);

		await session.prompt("Implement it.");
		await vi.waitFor(() => expect(reflections()).toHaveLength(1));

		const prompt = lastText(requests.at(-1)!);
		expect(prompt).toContain(
			"After your last change to `lib.ts`, these ran: `true`, `false` (failed), `true` (started in background).",
		);
		expect(prompt).toContain("Nothing ran after your last change to `app.ts`.");
	});

	it("stays quiet without a successful edit or write", async () => {
		const { session, requests, reflections } = await harness([
			tool("read", { path: "app.ts" }, "read-1"),
			tool("edit", { path: "missing.ts", edits: [{ oldText: "a", newText: "b" }] }, "edit-1"),
			fauxAssistantMessage("nothing changed"),
		]);

		await session.prompt("Look around.");
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(requests).toHaveLength(3);
		expect(reflections()).toHaveLength(0);
	});
});

describe("reflectionPrompt", () => {
	it("uses only the lens that applies", () => {
		const none = new Map<string, string[]>();
		expect(reflectionPrompt(["src/a.ts"], none)).toContain("simpler way");
		expect(reflectionPrompt(["src/a.ts"], none)).not.toContain("intended reader");
		expect(reflectionPrompt(["docs/a.md"], none)).toContain("intended reader");
		expect(reflectionPrompt(["docs/a.md"], none)).not.toContain("simpler way");
		expect(reflectionPrompt(["docs/a.md"], none)).not.toContain("ran");
		for (const path of ["tests/a.ts", "src/__tests__/a.ts", "a.test.ts", "a.spec.tsx", "a_test.go", "pkg/test_a.py"]) {
			expect(reflectionPrompt([path], none)).toContain("observable behavior the user wants now");
			expect(reflectionPrompt([path], none)).toContain("Nothing ran after your last change");
			expect(reflectionPrompt([path], none)).not.toContain("simpler way");
		}
		for (const path of ["src/contest.ts", "src/latest/a.ts", "tests/README.md"])
			expect(reflectionPrompt([path], none)).not.toContain("observable behavior");
	});

	it("groups code paths that share the same runs", () => {
		const runs = new Map([
			["a.ts", ["`npm test`"]],
			["b.ts", ["`npm test`"]],
		]);
		expect(reflectionPrompt(["a.ts", "b.ts"], runs)).toContain(
			"After your last change to `a.ts`, `b.ts`, these ran: `npm test`.",
		);
	});
});
