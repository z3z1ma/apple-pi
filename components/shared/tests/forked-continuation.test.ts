import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { AgentSession, ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import registerTasks from "../../tasks/src/index.js";
import { inForkedContinuation } from "../src/fork-context.js";
import { type ForkRequest, startFork } from "../src/forked-continuation.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose();
});

function call(name: string, args: Parameters<typeof fauxToolCall>[1], id: string): Reply {
	return fauxAssistantMessage(fauxToolCall(name, args, { id }), { stopReason: "toolUse" });
}

function lastText(context: Context): string {
	const last = context.messages.at(-1);
	if (!last || last.role === "system") return "";
	return typeof last.content === "string" ? last.content : JSON.stringify(last.content);
}

/** Replies by the fork's own prompt: the scripted tool call first, then a final answer after its result. */
function byPrompt(script: Script) {
	return (context: Context): Reply | "until-aborted" => {
		if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("fork done");
		const text = lastText(context);
		const entry = Object.entries(script).find(([prompt]) => text.includes(prompt));
		return entry ? entry[1] : fauxAssistantMessage("settled");
	};
}

type Script = Record<string, Reply | "until-aborted">;

function toolResult(messages: AgentMessage[], id: string) {
	const result = messages.find((message) => message.role === "toolResult" && message.toolCallId === id);
	if (result?.role !== "toolResult") throw new Error(`no result for ${id}`);
	return { isError: result.isError, text: JSON.stringify(result.content) };
}

/** A settled parent session; `script(cwd)` maps each fork prompt to its first reply. */
async function settledSession(script: Script | ((cwd: string) => Script), extensions: ExtensionFactory[] = []) {
	let replies: Script = {};
	const run = await fauxSession([registerTasks, ...extensions], (context) => byPrompt(replies)(context), [
		"read",
		"write",
		"edit",
		"bash",
		"ls",
	]);
	replies = typeof script === "function" ? script(run.cwd) : script;
	cleanup.push(run.dispose);
	await run.session.prompt("hello");
	return run;
}

function worktree(): string {
	const root = mkdtempSync(join(tmpdir(), "apple-pi-fork-worktree-"));
	cleanup.push(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

function prompt(text: string): AgentMessage {
	return { role: "custom", customType: "fork-test", content: text, display: false, timestamp: Date.now() };
}

function fork(session: AgentSession, cwd: string, text: string, request: Partial<ForkRequest> = {}) {
	return startFork(session, {
		messages: session.sessionManager.buildSessionProjection().messages,
		append: prompt(text),
		label: "fork test",
		worktree: { root: worktree(), parentRoot: cwd },
		...request,
	});
}

describe("worktree forks", () => {
	it("keeps the writes of concurrent forks in their own worktrees", async () => {
		const { session, cwd } = await settledSession({
			"fork A": call("write", { path: "notes.md", content: "A\n" }, "write-a"),
			"fork B": call("write", { path: "notes.md", content: "B\n" }, "write-b"),
		});
		const [a, b] = [worktree(), worktree()];
		const results = await Promise.all([
			fork(session, cwd, "fork A", { worktree: { root: a, parentRoot: cwd } }).result,
			fork(session, cwd, "fork B", { worktree: { root: b, parentRoot: cwd } }).result,
		]);

		expect(readFileSync(join(a, "notes.md"), "utf8")).toBe("A\n");
		expect(readFileSync(join(b, "notes.md"), "utf8")).toBe("B\n");
		expect(() => readFileSync(join(cwd, "notes.md"))).toThrow();
		expect(results.map((result) => result.messages.at(-1)?.role)).toEqual(["assistant", "assistant"]);
	});

	it("runs bash in the worktree and points the parent's absolute paths at it", async () => {
		const { session, cwd } = await settledSession((parent) => ({
			"fork shell": call(
				"bash",
				{
					command: `cd ${parent}>/dev/null; pwd -P > where.txt && echo absolute > ${parent}/absolute.txt`,
					verbatim: true,
				},
				"bash-1",
			),
		}));
		// Branch search keeps worktrees inside the parent's git directory.
		const root = join(cwd, ".git", "wt");
		mkdirSync(root, { recursive: true });
		await fork(session, cwd, "fork shell", { worktree: { root, parentRoot: cwd } }).result;

		expect(readFileSync(join(root, "where.txt"), "utf8").trim()).toBe(realpathSync(root));
		expect(readFileSync(join(root, "absolute.txt"), "utf8")).toBe("absolute\n");
		expect(existsSync(join(cwd, "absolute.txt"))).toBe(false);
	});

	it("refuses background commands in a worktree fork", async () => {
		const { session, cwd } = await settledSession({
			"fork background": call(
				"bash",
				{ command: "sleep 30", run_in_background: true, verbatim: true },
				"bash-background",
			),
		});
		const { messages } = await fork(session, cwd, "fork background").result;

		expect(toolResult(messages, "bash-background")).toEqual({
			isError: true,
			text: expect.stringContaining("Background commands are not available inside a branch search attempt."),
		});
	});

	it("refuses writes and edits outside the worktree", async () => {
		const outside = "/apple-pi-fork-guard";
		const { session, cwd } = await settledSession({
			"fork write": call("write", { path: `${outside}/notes.md`, content: "x" }, "write-out"),
			"fork edit": call("edit", { path: `${outside}/app.ts`, edits: [{ oldText: "a", newText: "b" }] }, "edit-out"),
		});
		const [write, edit] = await Promise.all([
			fork(session, cwd, "fork write").result,
			fork(session, cwd, "fork edit").result,
		]);

		const refusal = "Branch search isolates this attempt to its own copy of the repository.";
		expect(toolResult(write.messages, "write-out")).toEqual({ isError: true, text: expect.stringContaining(refusal) });
		expect(toolResult(edit.messages, "edit-out")).toEqual({ isError: true, text: expect.stringContaining(refusal) });
	});

	it("blocks the fork's blocked tools and keeps the parent's tool list", async () => {
		const { session, cwd, requests } = await settledSession({ "fork blocked": call("ls", {}, "ls-1") });
		const parentRequest = requests.at(-1);
		const { messages } = await fork(session, cwd, "fork blocked", { blockedTools: new Set(["ls"]) }).result;

		expect(toolResult(messages, "ls-1")).toEqual({
			isError: true,
			text: expect.stringContaining("This tool is not available inside a branch search attempt."),
		});
		const forkRequests = requests.slice(requests.indexOf(parentRequest as Context) + 1);
		expect(forkRequests.length).toBeGreaterThan(0);
		for (const request of forkRequests) expect(request.tools).toEqual(parentRequest?.tools);
	});

	it("sends the parent's request with only the appended message added", async () => {
		const { session, cwd, requests } = await settledSession({});
		const parentRequest = requests.at(-1) as Context;
		await fork(session, cwd, "fork prefix").result;
		const forkRequest = requests.at(-1) as Context;

		expect(forkRequest.systemPrompt).toEqual(parentRequest.systemPrompt);
		expect(forkRequest.tools).toEqual(parentRequest.tools);
		expect(forkRequest.messages.slice(0, parentRequest.messages.length)).toEqual(parentRequest.messages);
		expect(forkRequest.messages.slice(parentRequest.messages.length).map((message) => message.role)).toEqual([
			"assistant",
			"user",
		]);
		expect(lastText(forkRequest)).toContain("fork prefix");
	});

	it("starts from a pending tool call with a result appended", async () => {
		let parent: AgentSession | undefined;
		let forkRequest: Context | undefined;
		const pending = (pi: ExtensionAPI) =>
			pi.registerTool({
				name: "pending",
				label: "Pending",
				description: "Starts a fork from its own pending call.",
				parameters: Type.Object({}),
				async execute(toolCallId) {
					const session = parent as AgentSession;
					await startFork(session, {
						messages: session.sessionManager.buildSessionProjection().messages,
						append: {
							role: "toolResult",
							toolCallId,
							toolName: "pending",
							content: [{ type: "text", text: "fork pending" }],
							isError: false,
							timestamp: Date.now(),
						},
						label: "fork test",
					}).result;
					forkRequest = requests.find((request) => lastText(request).includes("fork pending"));
					return { content: [{ type: "text", text: "real result" }], details: {} };
				},
			});
		const run = await fauxSession(
			[pending],
			[call("pending", {}, "pending-1"), fauxAssistantMessage("fork reply")],
			["pending"],
		);
		const { requests } = run;
		cleanup.push(run.dispose);
		parent = run.session;
		await run.session.prompt("go");
		const parentNext = requests.find((request) => lastText(request).includes("real result")) as Context;

		expect(forkRequest).toBeDefined();
		const shared = parentNext.messages.length - 1;
		expect(forkRequest?.messages.length).toBe(parentNext.messages.length);
		expect(forkRequest?.messages.slice(0, shared)).toEqual(parentNext.messages.slice(0, shared));
		expect(forkRequest?.systemPrompt).toEqual(parentNext.systemPrompt);
		expect(forkRequest?.tools).toEqual(parentNext.tools);
	});

	it("aborts one fork while a sibling completes and the parent stays idle", async () => {
		const { session, cwd } = await settledSession({
			"fork stuck": "until-aborted",
			"fork busy": call("write", { path: "notes.md", content: "busy\n" }, "write-busy"),
		});
		const stuck = fork(session, cwd, "fork stuck");
		const busy = fork(session, cwd, "fork busy");
		setTimeout(() => stuck.abort(), 10);
		const [stopped, finished] = await Promise.all([stuck.result, busy.result]);

		const stop = (messages: AgentMessage[]) => {
			const last = messages.at(-1);
			return last?.role === "assistant" ? last.stopReason : last?.role;
		};
		expect(stop(stopped.messages)).toBe("aborted");
		expect(stop(finished.messages)).toBe("stop");
		expect(session.isStreaming).toBe(false);
	});

	it("marks its tool calls as forked and records its usage", async () => {
		const forked = new Map<string, boolean>();
		const recorder = (pi: ExtensionAPI) => {
			pi.on("tool_call", (event) => {
				forked.set(event.toolCallId, inForkedContinuation());
			});
		};
		const { session, cwd } = await settledSession({ "fork usage": call("ls", {}, "ls-usage") }, [recorder]);
		const { usage } = await fork(session, cwd, "fork usage").result;

		expect(forked.get("ls-usage")).toBe(true);
		expect(inForkedContinuation()).toBe(false);
		expect(usage).toHaveLength(2);
		expect(usage[0]).toHaveProperty("cacheRead");
		const entries = session.sessionManager
			.getEntries()
			.filter((entry) => entry.type === "usage" && entry.kind === "forked_continuation");
		expect(entries).toHaveLength(2);
	});

	it("reports each reply's usage as it arrives", async () => {
		const { session, cwd } = await settledSession({ "fork live usage": call("ls", {}, "ls-live") });
		const seen: number[] = [];
		const handle = fork(session, cwd, "fork live usage", { onUsage: (usage) => seen.push(usage.output) });
		const { usage } = await handle.result;

		expect(seen).toHaveLength(2);
		expect(seen).toEqual(usage.map((entry) => entry.output));
	});

	it("reads the worktree copy through the parent's absolute path", async () => {
		const { session, cwd } = await settledSession((parent) => ({
			"fork read": call("read", { path: `${parent}/..cache/data.txt` }, "read-1"),
		}));
		mkdirSync(join(cwd, "..cache"));
		writeFileSync(join(cwd, "..cache", "data.txt"), "parent copy\n");
		const root = worktree();
		mkdirSync(join(root, "..cache"));
		writeFileSync(join(root, "..cache", "data.txt"), "worktree copy\n");
		const { messages } = await fork(session, cwd, "fork read", { worktree: { root, parentRoot: cwd } }).result;

		expect(toolResult(messages, "read-1").text).toContain("worktree copy");
	});

	it("refuses a write that a symlink in the worktree leads into the parent workspace", async () => {
		const { session, cwd } = await settledSession({
			"fork symlink": call("write", { path: "link/escaped.md", content: "x" }, "write-link"),
		});
		const root = join(cwd, ".git", "wt");
		mkdirSync(root, { recursive: true });
		symlinkSync(cwd, join(root, "link"));
		const { messages } = await fork(session, cwd, "fork symlink", { worktree: { root, parentRoot: cwd } }).result;

		expect(toolResult(messages, "write-link")).toEqual({
			isError: true,
			text: expect.stringContaining("Branch search isolates this attempt to its own copy of the repository."),
		});
		expect(existsSync(join(cwd, "escaped.md"))).toBe(false);
	});

	it("works in the worktree's copy of the parent's subdirectory", async () => {
		const { session, cwd } = await settledSession({
			"fork subdir": call("bash", { command: "pwd -P > where.txt", verbatim: true }, "bash-subdir"),
		});
		// The parent session runs in a subdirectory of its repository.
		const repository = dirname(cwd);
		const root = worktree();
		mkdirSync(join(root, basename(cwd)));
		await fork(session, cwd, "fork subdir", { worktree: { root, parentRoot: repository } }).result;

		const copy = join(root, basename(cwd));
		expect(readFileSync(join(copy, "where.txt"), "utf8").trim()).toBe(realpathSync(copy));
	});
});
