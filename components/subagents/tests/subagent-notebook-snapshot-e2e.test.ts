import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { getSharedNotebook } from "../../notebook/src/shared-notebook.js";
import installPair from "../../pair-programmer/src/extension.js";
import { resumeAgent, runAgent } from "../src/agent-runner.js";
import installSubagents from "../src/index.js";
import { disposeAgentSession } from "../src/session-lifecycle.js";

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "apple-pi-snapshot-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
mkdirSync(join(agentDir, "agents"));
writeFileSync(join(agentDir, ".pair-state.json"), JSON.stringify({ enabled: false }));
writeFileSync(
	join(agentDir, "agents", "snapshot-coder.md"),
	"---\nname: snapshot-coder\ndescription: Snapshot coding fixture\ntools: read, write, bash\npair: false\nskills: false\npersist_session: false\nallowed_subagents: snapshot-leaf, snapshot-advisory\n---\n\nSnapshot coding child.\n",
);
writeFileSync(
	join(agentDir, "agents", "snapshot-leaf.md"),
	"---\nname: snapshot-leaf\ndescription: Nested snapshot fixture\ntools: write\npair: false\nskills: false\npersist_session: false\n---\n\nSnapshot leaf child.\n",
);
writeFileSync(
	join(agentDir, "agents", "snapshot-advisory.md"),
	"---\nname: snapshot-advisory\ndescription: Advisory snapshot fixture\ntools: read\npair: false\nskills: false\npersist_session: false\n---\n\nSnapshot advisory child.\n",
);

const roots: Awaited<ReturnType<typeof fauxSession>>[] = [];
const children: AgentSession[] = [];
afterEach(async () => {
	for (const child of children.splice(0)) await disposeAgentSession(child);
	for (const root of roots.splice(0)) {
		await root.session.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" });
		root.dispose();
	}
});
afterAll(() => {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(agentDir, { recursive: true, force: true });
});

function textOf(message: { content: unknown } | undefined): string {
	const content = message?.content;
	return Array.isArray(content)
		? content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("\n")
		: typeof content === "string"
			? content
			: "";
}

/** What the model reads in a request, excluding the system prompt and tool declarations. */
function conversationText(context: Context): string {
	return context.messages
		.filter((message) => (message.role as string) !== "system")
		.map(textOf)
		.join("\n");
}

function completionHandoff(context: Context) {
	if (!textOf(context.messages.at(-1)).startsWith("Before you hand off")) return undefined;
	return fauxAssistantMessage(textOf(context.messages.findLast((message) => message.role === "assistant")));
}

function call(name: string, args: Parameters<typeof fauxToolCall>[1]) {
	return fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
}

describe("shared-learning snapshots in coding children", () => {
	it("shows a direct coding child the primary's open learnings in its first request", async () => {
		const childRequests: Context[] = [];
		let rootStep = 0;
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				if (getCurrentSystemPrompt(context.messages).includes("Snapshot coding child.")) {
					childRequests.push(structuredClone(context));
					return completionHandoff(context) ?? fauxAssistantMessage("Child done.");
				}
				switch (rootStep++) {
					case 0:
						return call("update_notebook", {
							reflections: [{ content: "The fixture server needs PORT=4321; set it before starting." }],
						});
					case 1:
						return call("agent", {
							prompt: "Start the fixture server.",
							description: "Start server",
							subagent_type: "snapshot-coder",
						});
					default:
						return fauxAssistantMessage("Done.");
				}
			},
			["agent", "update_notebook"],
		);
		roots.push(root);
		await root.session.prompt("Record the port, then delegate.");
		expect(childRequests.length).toBeGreaterThan(0);
		expect(conversationText(childRequests[0])).toContain("The fixture server needs PORT=4321");
	}, 30_000);

	it("shows a nested coding child the primary's learnings but withholds them from an advisory child", async () => {
		const firstRequests = new Map<string, Context>();
		let rootStep = 0;
		let coderStep = 0;
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				const prompt = getCurrentSystemPrompt(context.messages);
				for (const role of ["leaf", "advisory"]) {
					if (!prompt.includes(`Snapshot ${role} child.`)) continue;
					if (!firstRequests.has(role)) firstRequests.set(role, structuredClone(context));
					return completionHandoff(context) ?? fauxAssistantMessage(`${role} done.`);
				}
				if (prompt.includes("Snapshot coding child.")) {
					const handoff = completionHandoff(context);
					if (handoff) return handoff;
					if (coderStep++ === 0)
						return fauxAssistantMessage(
							["snapshot-leaf", "snapshot-advisory"].map((type) =>
								fauxToolCall("agent", { prompt: "Check the cache.", description: type, subagent_type: type }),
							),
							{ stopReason: "toolUse" },
						);
					return fauxAssistantMessage("Nested work done.");
				}
				switch (rootStep++) {
					case 0:
						return call("update_notebook", {
							reflections: [{ content: "The nested cache lives in .cache/build; clear it before retrying." }],
						});
					case 1:
						return call("agent", {
							prompt: "Delegate the cache checks.",
							description: "Nested checks",
							subagent_type: "snapshot-coder",
						});
					default:
						return fauxAssistantMessage("Done.");
				}
			},
			["agent", "update_notebook"],
		);
		roots.push(root);
		await root.session.prompt("Record the cache location, then delegate.");
		expect(conversationText(firstRequests.get("leaf")!)).toContain("The nested cache lives in .cache/build");
		expect(conversationText(firstRequests.get("advisory")!)).toContain("Check the cache.");
		expect(conversationText(firstRequests.get("advisory")!)).not.toContain("The nested cache lives");
	}, 30_000);

	it("lets a running child read a sibling's new learning without broadcasting it", async () => {
		const sibling = "The beta endpoint requires a trailing slash; include it on every call.";
		let notifySiblingRecorded!: () => void;
		const siblingRecorded = new Promise<void>((resolve) => {
			notifySiblingRecorded = resolve;
		});
		let notifyAlphaStarted!: () => void;
		const alphaStarted = new Promise<void>((resolve) => {
			notifyAlphaStarted = resolve;
		});
		let notifyAlphaRead!: (request: Context) => void;
		const alphaRead = new Promise<Context>((resolve) => {
			notifyAlphaRead = resolve;
		});
		const alphaRequests: Context[] = [];
		const steps = new Map<string, number>();
		let rootStep = 0;
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				if (getCurrentSystemPrompt(context.messages).includes("Snapshot coding child.")) {
					const handoff = completionHandoff(context);
					if (handoff) return handoff;
					const label = conversationText(context).includes("Work on alpha.") ? "alpha" : "beta";
					const step = steps.get(label) ?? 0;
					steps.set(label, step + 1);
					if (label === "beta") {
						// Beta records only once alpha has launched and is mid-run.
						if (step === 0)
							return alphaStarted.then(() => call("update_notebook", { reflections: [{ content: sibling }] }));
						notifySiblingRecorded();
						return fauxAssistantMessage("Beta recorded.");
					}
					alphaRequests.push(structuredClone(context));
					switch (step) {
						case 0:
							notifyAlphaStarted();
							return siblingRecorded.then(() => call("bash", { command: "true" }));
						case 1:
							return call("read_notebook", {});
						case 2:
							notifyAlphaRead(structuredClone(context));
							return fauxAssistantMessage("Alpha read the notebook.");
						default:
							return fauxAssistantMessage("Alpha done.");
					}
				}
				if (rootStep++ === 0)
					return fauxAssistantMessage(
						["alpha", "beta"].map((label) =>
							fauxToolCall("agent", {
								prompt: `Work on ${label}.`,
								description: label,
								subagent_type: "snapshot-coder",
								run_in_background: true,
							}),
						),
						{ stopReason: "toolUse" },
					);
				return fauxAssistantMessage("Children launched.");
			},
			["agent"],
		);
		roots.push(root);
		await root.session.prompt("Launch alpha and beta.");
		const afterRead = await alphaRead;
		// The request sent after the sibling's addition, before alpha asked, carries no update.
		expect(conversationText(alphaRequests[1])).not.toContain(sibling);
		const carriers = afterRead.messages.filter((message) => textOf(message).includes(sibling));
		expect(carriers.map((message) => message.role)).toEqual(["toolResult"]);
	}, 30_000);

	it.each(["tool-result", "overflow"] as const)(
		"includes fresh learnings in the first request after automatic %s compaction",
		async (mode) => {
			const launchLearning = "The automatic fixture uses localhost; connect locally.";
			const freshLearning = "The automatic fixture now requires X-Session; send that header.";
			let hostPi!: ExtensionAPI;
			let hostCtx!: ExtensionContext;
			let child!: AgentSession;
			let stage: "launch" | "trigger" | "compacted" = "launch";
			let firstAfterCompaction: Context | undefined;
			const requestsAfterCompaction: Context[] = [];
			const captureHost = (pi: ExtensionAPI) => {
				hostPi = pi;
				pi.on("before_agent_start", (_event, ctx) => {
					hostCtx = ctx;
				});
			};
			const replies = [
				call("update_notebook", { reflections: [{ content: launchLearning }] }),
				fauxAssistantMessage("Recorded."),
				call("update_notebook", { reflections: [{ content: freshLearning }] }),
				fauxAssistantMessage("Recorded."),
			];
			const root = await fauxSession(
				[installPair, installSubagents, captureHost],
				(context) => {
					const prompt = getCurrentSystemPrompt(context.messages);
					if (prompt.includes("context summarization assistant")) {
						stage = "compacted";
						return fauxAssistantMessage("## Goal\nAutomatic compaction preserved the task.");
					}
					if (prompt.includes("Snapshot coding child.")) {
						if (stage === "trigger") {
							stage = "launch";
							if (mode === "tool-result")
								return call("bash", { command: `printf '%s' '${"log entry\n".repeat(8_000)}'` });
							const overflow = fauxAssistantMessage("", {
								stopReason: "error",
								errorMessage: "Your input exceeds the context window of this model",
							});
							overflow.provider = child.model!.provider;
							overflow.model = child.model!.id;
							return overflow;
						}
						if (stage === "compacted") requestsAfterCompaction.push(structuredClone(context));
						if (stage === "compacted" && !firstAfterCompaction) {
							firstAfterCompaction = structuredClone(context);
							child.settingsManager.setCompactionEnabled(false);
						}
						return completionHandoff(context) ?? fauxAssistantMessage("Child finished.");
					}
					return replies.shift() ?? fauxAssistantMessage("Root finished.");
				},
				["update_notebook"],
			);
			roots.push(root);
			await root.session.prompt("Record the launch discovery.");
			const launched = await runAgent(hostCtx, "snapshot-coder", "Inspect the fixture.", {
				pi: hostPi,
				notebook: getSharedNotebook(hostPi.events),
				pair: false,
				completionReflection: true,
			});
			child = launched.session;
			children.push(child);
			child.settingsManager.setCompactionEnabled(false);
			await resumeAgent(child, `Keep this earlier task evidence. ${"earlier log ".repeat(500)}`);
			await root.session.prompt("Record the new header discovery.");
			child.settingsManager.applyOverrides({
				compaction: { enabled: true, reserveTokens: 90_000, keepRecentTokens: 1_000 },
			});
			stage = "trigger";
			const result = await resumeAgent(child, "Read the large log and continue.");
			expect(result.failure).toBeUndefined();
			expect(firstAfterCompaction).toBeDefined();
			expect(conversationText(firstAfterCompaction!)).toContain("Automatic compaction preserved the task.");
			expect(conversationText(firstAfterCompaction!).includes(freshLearning)).toBe(true);
			for (let index = 1; index < requestsAfterCompaction.length; index++) {
				const previous = requestsAfterCompaction[index - 1].messages;
				expect(requestsAfterCompaction[index].messages.slice(0, previous.length)).toEqual(previous);
			}
		},
	);

	it("appends a fresh snapshot after child compaction and otherwise keeps request history append-only", async () => {
		const launchLearning = "The launch-time lint needs --cache; pass it to avoid a cold run.";
		const laterLearning = "The later migration needs --dry-run first; run it before applying.";
		const bulk = `Continue with the attached log.\n${"log line\n".repeat(10_000)}`;
		let hostPi!: ExtensionAPI;
		let hostCtx!: ExtensionContext;
		const captureHost = (pi: ExtensionAPI) => {
			hostPi = pi;
			pi.on("before_agent_start", (_event, ctx) => {
				hostCtx = ctx;
			});
		};
		const childRequests: Context[] = [];
		const rootReplies = [
			call("update_notebook", { reflections: [{ content: launchLearning }] }),
			fauxAssistantMessage("Recorded."),
			call("update_notebook", { reflections: [{ content: laterLearning }] }),
			fauxAssistantMessage("Recorded."),
		];
		const root = await fauxSession(
			[installPair, installSubagents, captureHost],
			(context) => {
				const prompt = getCurrentSystemPrompt(context.messages);
				if (prompt.includes("context summarization assistant"))
					return fauxAssistantMessage("## Goal\nScripted compaction summary.");
				if (prompt.includes("Snapshot coding child.")) {
					childRequests.push(structuredClone(context));
					return completionHandoff(context) ?? fauxAssistantMessage("Child step done.");
				}
				return rootReplies.shift() ?? fauxAssistantMessage("Root done.");
			},
			["update_notebook"],
		);
		roots.push(root);
		await root.session.prompt("Record the lint discovery.");
		const notebook = getSharedNotebook(hostPi.events)!;
		const launched = await runAgent(hostCtx, "snapshot-coder", "Lint the project.", {
			pi: hostPi,
			notebook,
			pair: false,
			completionReflection: true,
		});
		children.push(launched.session);
		await root.session.prompt("Record the migration discovery.");
		await resumeAgent(launched.session, bulk);
		const beforeCompaction = childRequests.length;
		await launched.session.compact();
		await resumeAgent(launched.session, "Continue after compaction.");

		const ordinary = childRequests.slice(0, beforeCompaction);
		for (let index = 1; index < ordinary.length; index++)
			expect(ordinary[index].messages.slice(0, ordinary[index - 1].messages.length)).toEqual(
				ordinary[index - 1].messages,
			);
		expect(conversationText(ordinary[0])).toContain(launchLearning);
		// An ordinary resume is not a snapshot boundary.
		expect(conversationText(ordinary.at(-1)!)).not.toContain(laterLearning);

		const compacted = childRequests[beforeCompaction];
		expect(conversationText(compacted)).toContain("Scripted compaction summary.");
		const snapshotIndex = compacted.messages.findLastIndex((message) => textOf(message).includes(laterLearning));
		expect(textOf(compacted.messages[snapshotIndex])).toContain(launchLearning);
		// Messages that survive compaction keep their exact earlier form and order.
		const survivorsStart = ordinary.at(-1)!.messages.findIndex((message) => textOf(message).startsWith(bulk));
		const survivors = ordinary.at(-1)!.messages.slice(survivorsStart);
		const keptStart = compacted.messages.findIndex((message) => textOf(message).startsWith(bulk));
		expect(survivorsStart).toBeGreaterThan(0);
		expect(survivors.length).toBeGreaterThan(1);
		expect(keptStart).toBeGreaterThan(0);
		expect(compacted.messages.slice(keptStart, keptStart + survivors.length)).toEqual(survivors);
		// The fresh snapshot is appended after them rather than inserted into retained history.
		expect(snapshotIndex).toBeGreaterThanOrEqual(keptStart + survivors.length);
		for (let index = beforeCompaction + 1; index < childRequests.length; index++)
			expect(childRequests[index].messages.slice(0, childRequests[index - 1].messages.length)).toEqual(
				childRequests[index - 1].messages,
			);
	}, 30_000);
});
