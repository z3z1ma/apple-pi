import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type ExtensionAPI,
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import installPair from "../../pair-programmer/src/extension.js";
import { getSharedNotebook } from "../../notebook/src/shared-notebook.js";
import { runAgent } from "../src/agent-runner.js";
import { disposeAgentSession } from "../src/session-lifecycle.js";
import installSubagents from "../src/index.js";

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "apple-pi-notebook-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
mkdirSync(join(agentDir, "agents"));
writeFileSync(join(agentDir, ".pair-state.json"), JSON.stringify({ enabled: false }));
writeFileSync(
	join(agentDir, "agents", "notebook-coder.md"),
	"---\nname: notebook-coder\ndescription: Notebook integration fixture\ntools: read, write, bash\npair: false\nskills: false\npersist_session: false\nallowed_subagents: notebook-leaf\n---\n\nNotebook coding child.\n",
);

writeFileSync(
	join(agentDir, "agents", "notebook-leaf.md"),
	"---\nname: notebook-leaf\ndescription: Nested notebook fixture\ntools: write\npair: false\nskills: false\npersist_session: false\n---\n\nNotebook leaf child.\n",
);

for (const name of ["notebook-advisory", "notebook-restricted"]) {
	writeFileSync(
		join(agentDir, "agents", `${name}.md`),
		`---\nname: ${name}\ndescription: Non-coding scope fixture\ntools: ${name === "notebook-advisory" ? "read" : "read, write"}\ndisallowed_tools: write\npair: false\nskills: false\npersist_session: false\n---\n\nNotebook non-coding child.\n`,
	);
}

const roots: Awaited<ReturnType<typeof fauxSession>>[] = [];
const directories: string[] = [];
const directChildren: AgentSession[] = [];
afterEach(async () => {
	for (const child of directChildren.splice(0)) await disposeAgentSession(child);
	for (const root of roots.splice(0)) {
		await root.session.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" });
		root.dispose();
	}
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
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

function call(name: string, args: Parameters<typeof fauxToolCall>[1]) {
	return fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
}

describe("shared notebook through real interactive sessions", () => {
	it("commits a child's learning before completion and retains it after stop", async () => {
		let notifyRecorded!: () => void;
		const recorded = new Promise<void>((resolve) => {
			notifyRecorded = resolve;
		});
		let childStep = 0;
		let rootStep = 0;
		let receipt = "";
		let noteId = "";
		let agentId = "";
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				if (getCurrentSystemPrompt(context.messages).includes("Notebook coding child.")) {
					if (childStep++ === 0)
						return call("update_notebook", {
							reflections: [{ content: "The temporary service uses port 4321; connect to that port next time." }],
						});
					receipt = textOf(context.messages.at(-1));
					noteId = receipt.match(/\b[a-f0-9]{12}\b/)?.[0] ?? "";
					notifyRecorded();
					return "until-aborted";
				}
				switch (rootStep++) {
					case 0:
						return call("agent", {
							prompt: "Record the service access discovery, then keep working.",
							description: "Record a discovery",
							subagent_type: "notebook-coder",
							run_in_background: true,
							pair: false,
						});
					case 1:
						agentId = textOf(context.messages.at(-1)).match(/Agent ID: ([a-f0-9-]+)/)?.[1] ?? "";
						return fauxAssistantMessage("Child is still working.");
					case 2:
						return call("revisit_note", { id: noteId });
					case 3:
						return fauxAssistantMessage(textOf(context.messages.at(-1)));
					case 4:
						return call("stop_subagent", { agent_id: agentId });
					case 5:
						return fauxAssistantMessage("Child stopped.");
					case 6:
						return call("revisit_note", { id: noteId });
					default:
						return fauxAssistantMessage(textOf(context.messages.at(-1)));
				}
			},
			["agent", "stop_subagent", "revisit_note"],
		);
		roots.push(root);
		await root.session.prompt("Launch the child.");
		await recorded;
		expect(receipt).toContain("Notebook updated");
		await root.session.prompt("Recall the discovery while the child is running.");
		expect(root.session.getLastAssistantText()).toContain("Record the service access discovery");
		expect(root.session.getLastAssistantText()).toContain(`[${noteId}] The temporary service uses port 4321`);
		await root.session.prompt("Stop the child.");
		await root.session.prompt("Recall the discovery after stopping it.");
		expect(root.session.getLastAssistantText()).toContain("Record the service access discovery");
		expect(root.session.getLastAssistantText()).toContain(`[${noteId}] The temporary service uses port 4321`);
	}, 30_000);

	it.each(["tree", "shutdown"])(
		"rejects an actual stale capability write after %s",
		async (operation) => {
			let hostPi!: ExtensionAPI;
			let hostCtx!: ExtensionContext;
			let childStep = 0;
			let accepted = "";
			let rejected = false;
			const captureHost = (pi: ExtensionAPI) => {
				hostPi = pi;
				pi.on("before_agent_start", (_event, ctx) => {
					hostCtx = ctx;
				});
			};
			const script: Parameters<typeof fauxSession>[1] = (context) => {
				if (!getCurrentSystemPrompt(context.messages).includes("Notebook coding child."))
					return fauxAssistantMessage("Host ready.");
				switch (childStep++) {
					case 0:
						return call("update_notebook", {
							reflections: [{ content: "The original owner accepted a real child learning; keep that evidence." }],
						});
					case 1:
						accepted = textOf(context.messages.at(-1));
						return fauxAssistantMessage("Initial capture complete.");
					case 2:
						return call("update_notebook", {
							reflections: [{ content: "STALE_OWNER_WRITE must be rejected even with a fresh invocation signal." }],
						});
					default: {
						const result = context.messages.at(-1);
						rejected = result?.role === "toolResult" && result.isError;
						return fauxAssistantMessage("Capture rejected and reported.");
					}
				}
			};
			const original = await fauxSession([installPair, installSubagents, captureHost], script, ["revisit_note"]);
			roots.push(original);
			await original.session.prompt("Create the original owning branch.");
			const notebook = getSharedNotebook(hostPi.events)!;
			const first = await runAgent(hostCtx, "notebook-coder", "Capture real evidence.", {
				pi: hostPi,
				notebook,
				pair: false,
			});
			directChildren.push(first.session);
			expect(accepted).toContain("Notebook updated");
			let current = original;
			if (operation === "tree") {
				await original.session.navigateTree(original.session.getUserMessagesForForking()[0].entryId, {
					summarize: false,
				});
			} else {
				await original.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
				current = await fauxSession([installPair, installSubagents, captureHost], script, ["revisit_note"]);
				roots.push(current);
			}
			await current.session.prompt("Establish a fresh active owner.");
			const previousArchive = structuredClone(original.session.sessionManager.getEntries());
			const currentArchive = structuredClone(current.session.sessionManager.getEntries());
			const freshSignal = new AbortController().signal;
			const attempted = await runAgent(hostCtx, "notebook-coder", "Attempt the old capability after replacement.", {
				pi: hostPi,
				notebook,
				pair: false,
				signal: freshSignal,
			});
			directChildren.push(attempted.session);
			expect(freshSignal.aborted).toBe(false);
			expect(rejected).toBe(true);
			expect(attempted.responseText).toContain("Capture rejected and reported");
			expect(original.session.sessionManager.getEntries()).toEqual(previousArchive);
			expect(current.session.sessionManager.getEntries()).toEqual(currentArchive);
		},
		30_000,
	);

	it.each(["tree", "shutdown"])(
		"recalls an active contributor's accepted learning from its original archive after owner %s",
		async (operation) => {
			const cwd = mkdtempSync(join(tmpdir(), "apple-pi-owner-archive-"));
			directories.push(cwd);
			let notifyRecorded!: () => void;
			const recorded = new Promise<void>((resolve) => {
				notifyRecorded = resolve;
			});
			let rootStep = 0;
			let childStep = 0;
			let noteId = "";
			let agentId = "";
			const root = await fauxSession(
				[installPair, installSubagents],
				(context) => {
					if (getCurrentSystemPrompt(context.messages).includes("Notebook coding child.")) {
						if (childStep++ === 0)
							return call("update_notebook", {
								reflections: [
									{ content: "The owner-bound lookup succeeded; reuse its endpoint while that owner is active." },
								],
							});
						noteId = textOf(context.messages.at(-1)).match(/\b[a-f0-9]{12}\b/)?.[0] ?? "";
						notifyRecorded();
						return "until-aborted";
					}
					switch (rootStep++) {
						case 0:
							return fauxAssistantMessage("Navigation anchor ready.");
						case 1:
							return call("agent", {
								prompt: "Discover the owner-bound endpoint and continue working.",
								description: "Owner lifetime",
								subagent_type: "notebook-coder",
								run_in_background: true,
								pair: false,
							});
						case 2:
							agentId = textOf(context.messages.at(-1)).match(/Agent ID: ([a-f0-9-]+)/)?.[1] ?? "";
							return fauxAssistantMessage("Contributor launched.");
						case 3:
							return call("get_subagent_result", { agent_id: agentId, yield_seconds: 0, verbose: false });
						case 4:
							return fauxAssistantMessage(textOf(context.messages.at(-1)));
						default:
							return fauxAssistantMessage("Fresh branch ready.");
					}
				},
				["agent", "get_subagent_result", "revisit_note"],
				{ cwd, sessionManager: SessionManager.create(cwd, join(cwd, "sessions")) },
			);
			roots.push(root);
			await root.session.prompt("Establish an earlier branch point.");
			const anchor = root.session.getUserMessagesForForking()[0].entryId;
			await root.session.prompt("Launch the contributor.");
			await recorded;
			expect(noteId).toMatch(/^[a-f0-9]{12}$/);
			await root.session.prompt("Check the ongoing child.");
			expect(root.session.getLastAssistantText()).toContain("running");
			const acceptedLeaf = root.session.sessionManager.getLeafId()!;
			const sessionFile = root.session.sessionFile!;
			if (operation === "tree") {
				const navigation = await root.session.navigateTree(anchor, { summarize: false });
				expect(navigation.cancelled).toBe(false);
				await root.session.prompt("Continue the new branch.");
			} else {
				await root.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			}
			await root.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			root.dispose();
			const reopened = await fauxSession(
				[installPair],
				[call("revisit_note", { id: noteId }), fauxAssistantMessage("Original branch recalled.")],
				["revisit_note"],
				{ cwd, sessionManager: SessionManager.open(sessionFile) },
			);
			roots.push(reopened);
			await reopened.session.navigateTree(acceptedLeaf, { summarize: false });
			await reopened.session.prompt("Recall the accepted learning on its original branch.");
			const result = reopened.session.messages.findLast((message) => message.role === "toolResult");
			expect(textOf(result)).toContain(`[${noteId}] The owner-bound lookup succeeded`);
			expect(textOf(result)).toContain("Discover the owner-bound endpoint and continue working");
		},
		30_000,
	);

	it.each(["notebook-advisory", "notebook-restricted"])(
		"withholds shared notebook authority from %s",
		async (type) => {
			let childTools: string[] = [];
			let rootStep = 0;
			const root = await fauxSession(
				[installPair, installSubagents],
				(context) => {
					if (getCurrentSystemPrompt(context.messages).includes("Notebook non-coding child.")) {
						childTools = getCurrentTools(context.messages).map((tool) => tool.name);
						return fauxAssistantMessage("Advisory lookup only.");
					}
					if (rootStep++ === 0)
						return call("agent", {
							prompt: "Inspect without editing.",
							description: "Check advisory scope",
							subagent_type: type,
							pair: false,
						});
					return fauxAssistantMessage(textOf(context.messages.at(-1)));
				},
				["agent"],
			);
			roots.push(root);
			await root.session.prompt("Delegate an advisory lookup.");
			expect(root.session.getLastAssistantText()).toContain("Advisory lookup only");
			expect(childTools).toContain("read");
			for (const tool of ["read_notebook", "update_notebook", "revisit_note"]) expect(childTools).not.toContain(tool);
		},
		30_000,
	);

	it("keeps child access add-only and reads fresh primary curation on resume", async () => {
		let root!: Awaited<ReturnType<typeof fauxSession>>;
		let rootStep = 0;
		let childStep = 0;
		let originalId = "";
		let primarySourceId = "";
		let agentId = "";
		let firstRead = "";
		let afterAttempts = "";
		let freshRead = "";
		let rejected: boolean[] = [];
		root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				if (getCurrentSystemPrompt(context.messages).includes("Notebook coding child.")) {
					switch (childStep++) {
						case 0:
							return call("read_notebook", {});
						case 1:
							firstRead = textOf(context.messages.at(-1));
							return call("update_notebook", {
								reflections: [{ content: "Child discovered a working retry command; use it after transient failure." }],
							});
						case 2:
							return fauxAssistantMessage(
								[
									fauxToolCall("update_notebook", { reflections: [], retireReflectionIds: [originalId] }),
									fauxToolCall("update_notebook", { reflections: [], retainReflectionIds: [] }),
									fauxToolCall("update_notebook", {
										reflections: [{ content: "Replace the primary learning.", supersedes: [originalId] }],
									}),
									fauxToolCall("update_notebook", {
										reflections: [{ content: "Invented source.", sourceEntryIds: ["fabricated-source"] }],
									}),
									fauxToolCall("update_notebook", {
										reflections: [{ content: "Unauthorized root source.", sourceEntryIds: [primarySourceId] }],
									}),
								],
								{ stopReason: "toolUse" },
							);
						case 3:
							rejected = context.messages
								.filter((message) => message.role === "toolResult")
								.slice(-5)
								.map((message) => message.role === "toolResult" && message.isError);
							return call("read_notebook", {});
						case 4:
							afterAttempts = textOf(context.messages.at(-1));
							return fauxAssistantMessage("Child contribution complete.");
						case 5:
							return call("read_notebook", {});
						default:
							freshRead = textOf(context.messages.at(-1));
							return fauxAssistantMessage("Fresh shared learning read.");
					}
				}
				switch (rootStep++) {
					case 0:
						return call("update_notebook", {
							reflections: [{ content: "The original install workaround succeeded; use that workaround." }],
						});
					case 1:
						originalId = textOf(context.messages.at(-1)).match(/\b[a-f0-9]{12}\b/)?.[0] ?? "";
						primarySourceId =
							root.session.sessionManager
								.getBranch()
								.find((entry) => entry.type === "message" && entry.message.role === "user")?.id ?? "";
						return call("agent", {
							prompt: "Contribute a discovery and check shared authority.",
							description: "Notebook permissions",
							subagent_type: "notebook-coder",
							pair: false,
						});
					case 2:
						agentId = textOf(context.messages.at(-1)).match(/Agent ID: ([a-f0-9-]+)/)?.[1] ?? "";
						return fauxAssistantMessage("Child finished.");
					case 3:
						return call("update_notebook", {
							reflections: [{ content: "The new install workaround is now proven; use the new workaround." }],
							retireReflectionIds: [originalId],
						});
					case 5:
						return call("agent", {
							resume: agentId,
							prompt: "Read the current shared learning.",
							description: "Fresh notebook read",
							subagent_type: "notebook-coder",
						});
					default:
						return fauxAssistantMessage("Primary operation complete.");
				}
			},
			["agent", "update_notebook", "revisit_note"],
		);
		roots.push(root);
		await root.session.prompt("Start a notebook authority check.");
		expect(firstRead).toContain("original install workaround");
		expect(rejected).toEqual([true, true, true, true, true]);
		expect(afterAttempts).toContain("original install workaround");
		expect(afterAttempts).toContain("Child discovered a working retry command");
		expect(afterAttempts).not.toContain("Invented source.");
		expect(afterAttempts).not.toContain("Unauthorized root source.");
		await root.session.prompt("Retire the old discovery and record the newly proven workaround.");
		await root.session.prompt("Resume the child to read the shared notebook.");
		expect(freshRead).toContain("new install workaround is now proven");
		expect(freshRead).not.toContain("original install workaround");
		expect(freshRead).toContain("Child discovered a working retry command");
	}, 30_000);

	it("preserves concurrent additions through one failure and one cancellation", async () => {
		let notifyRecorded!: () => void;
		const recorded = new Promise<void>((resolve) => {
			notifyRecorded = resolve;
		});
		const childSteps = new Map<string, number>();
		const notes = new Map<string, string>();
		let rootStep = 0;
		let agentIds: string[] = [];
		let failedResult = "";
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				if (getCurrentSystemPrompt(context.messages).includes("Notebook coding child.")) {
					const label = JSON.stringify(context.messages.filter((message) => message.role === "user")).includes("alpha")
						? "alpha"
						: "beta";
					const step = childSteps.get(label) ?? 0;
					childSteps.set(label, step + 1);
					if (step === 0)
						return call("update_notebook", {
							reflections: [
								{ content: `${label} discovered a distinct service address; use its documented address on retry.` },
							],
						});
					notes.set(label, textOf(context.messages.at(-1)).match(/\b[a-f0-9]{12}\b/)?.[0] ?? "");
					if (notes.size === 2) notifyRecorded();
					return label === "alpha"
						? "until-aborted"
						: fauxAssistantMessage("", { stopReason: "error", errorMessage: "Fixture provider rejected request" });
				}
				const toolResults = context.messages.filter((message) => message.role === "toolResult");
				switch (rootStep++) {
					case 0:
						return fauxAssistantMessage(
							["alpha", "beta"].map((label) =>
								fauxToolCall("agent", {
									prompt: `Discover ${label}'s address.`,
									description: label,
									subagent_type: "notebook-coder",
									run_in_background: true,
									pair: false,
								}),
							),
							{ stopReason: "toolUse" },
						);
					case 1:
						agentIds = toolResults.map((result) => textOf(result).match(/Agent ID: ([a-f0-9-]+)/)?.[1] ?? "");
						return fauxAssistantMessage("Both children launched.");
					case 2:
						return call("get_subagent_result", { agent_id: agentIds[1], verbose: false });
					case 3:
						failedResult = textOf(context.messages.at(-1));
						return fauxAssistantMessage("Failed result consumed.");
					case 4:
					case 8:
						return fauxAssistantMessage(
							[...notes.values()].map((id) => fauxToolCall("revisit_note", { id })),
							{ stopReason: "toolUse" },
						);
					case 6:
						return call("stop_subagent", { agent_id: agentIds[0] });
					case 7:
						return fauxAssistantMessage("Other child stopped.");
					default:
						return fauxAssistantMessage(toolResults.slice(-2).map(textOf).join("\n"));
				}
			},
			["agent", "get_subagent_result", "stop_subagent", "revisit_note"],
		);
		roots.push(root);
		await root.session.prompt("Launch two independent discoveries.");
		await recorded;
		expect([...notes.values()].every((id) => /^[a-f0-9]{12}$/.test(id))).toBe(true);
		await root.session.prompt("Retrieve the failed child.");
		expect(failedResult).toContain("Fixture provider rejected request");
		await root.session.prompt("Recall both while the other child is working.");
		for (const label of ["alpha", "beta"]) {
			expect(root.session.getLastAssistantText()).toContain(`Discover ${label}'s address`);
			expect(root.session.getLastAssistantText()).toContain(
				`[${notes.get(label)}] ${label} discovered a distinct service address`,
			);
		}
		await root.session.prompt("Stop the remaining child.");
		await root.session.prompt("Recall both accepted discoveries again.");
		for (const label of ["alpha", "beta"]) {
			expect(root.session.getLastAssistantText()).toContain(`Discover ${label}'s address`);
			expect(root.session.getLastAssistantText()).toContain(
				`[${notes.get(label)}] ${label} discovered a distinct service address`,
			);
		}
	}, 30_000);

	it("exposes a grandchild's learning before either child finishes and retains it after stop", async () => {
		let rootStep = 0;
		let coderStep = 0;
		let leafStep = 0;
		let noteId = "";
		let parentId = "";
		let notifyLeaf!: () => void;
		const leafRecorded = new Promise<void>((resolve) => {
			notifyLeaf = resolve;
		});
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				const prompt = getCurrentSystemPrompt(context.messages);
				if (prompt.includes("Notebook leaf child.")) {
					if (leafStep++ === 0)
						return call("update_notebook", {
							reflections: [{ content: "The nested build uses a separate cache; clear that cache when retrying." }],
						});
					noteId = textOf(context.messages.at(-1)).match(/\b[a-f0-9]{12}\b/)?.[0] ?? "";
					notifyLeaf();
					return "until-aborted";
				}
				if (prompt.includes("Notebook coding child.")) {
					if (coderStep++ === 0)
						return call("agent", {
							prompt: "Discover the nested cache.",
							description: "Nested discovery",
							subagent_type: "notebook-leaf",
							pair: false,
						});
					return fauxAssistantMessage("Nested discovery recorded.");
				}
				switch (rootStep++) {
					case 0:
						return call("agent", {
							prompt: "Delegate the nested cache discovery.",
							description: "Nested notebook",
							subagent_type: "notebook-coder",
							pair: false,
							run_in_background: true,
						});
					case 1:
						parentId = textOf(context.messages.at(-1)).match(/Agent ID: ([a-f0-9-]+)/)?.[1] ?? "";
						return fauxAssistantMessage("Nested work launched.");
					case 2:
					case 6:
						return call("revisit_note", { id: noteId });
					case 4:
						return call("stop_subagent", { agent_id: parentId });
					default:
						return fauxAssistantMessage(textOf(context.messages.at(-1)));
				}
			},
			["agent", "revisit_note", "stop_subagent"],
		);
		roots.push(root);
		await root.session.prompt("Delegate a cache investigation.");
		await leafRecorded;
		expect(noteId).toMatch(/^[a-f0-9]{12}$/);
		await root.session.prompt("Recall while the grandchild and its parent are still working.");
		expect(root.session.getLastAssistantText()).toContain("Child notebook-leaf");
		expect(root.session.getLastAssistantText()).toContain("Discover the nested cache");
		expect(root.session.getLastAssistantText()).toContain(`[${noteId}] The nested build uses a separate cache`);
		await root.session.prompt("Stop the nested work.");
		await root.session.prompt("Recall the accepted nested discovery after stop.");
		expect(root.session.getLastAssistantText()).toContain("Discover the nested cache");
		expect(root.session.getLastAssistantText()).toContain(`[${noteId}] The nested build uses a separate cache`);
	}, 30_000);

	it("recalls only cited original child commands and results after archive reopen", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "apple-pi-child-evidence-"));
		directories.push(cwd);
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		let childStep = 0;
		let rootStep = 0;
		let noteId = "";
		let sourceIds: string[] = [];
		let childRecall = "";
		let recalledAddresses: string[] = [];
		let curation = "";
		const curatedLearning = "The child-only endpoint probe is proven; use the same probe when retrying.";
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				if (getCurrentSystemPrompt(context.messages).includes("Notebook coding child.")) {
					switch (childStep++) {
						case 0:
							return call("bash", { command: "printf 'UNCITED_CHILD_SECRET\\n'" });
						case 1:
							return fauxAssistantMessage(
								[
									fauxToolCall(
										"bash",
										{ command: "printf 'CHILD_ONLY_COMMAND_RESULT\\n'" },
										{ id: "cited-child-command" },
									),
								],
								{ stopReason: "toolUse" },
							);
						case 2:
							return call("read_notebook", {});
						case 3:
							sourceIds = textOf(context.messages.at(-1))
								.split("\n")
								.filter((line) => line.includes("cited-child-command"))
								.map((line) => line.match(/^\[([^\]]+)\]/)?.[1] ?? "")
								.filter(Boolean);
							if (sourceIds.length !== 2) return fauxAssistantMessage("Source addresses unavailable.");
							return call("update_notebook", {
								reflections: [
									{
										content: "The endpoint probe returned the child-only result; use that probe next time.",
										sourceEntryIds: sourceIds,
									},
								],
							});
						case 4:
							noteId = textOf(context.messages.at(-1)).match(/\b[a-f0-9]{12}\b/)?.[0] ?? "";
							return call("revisit_note", { id: noteId });
						default:
							childRecall = textOf(context.messages.at(-1));
							return fauxAssistantMessage(`Saved learning ${noteId}.`);
					}
				}
				switch (rootStep++) {
					case 0:
						return call("agent", {
							prompt: "Discover and selectively cite endpoint evidence.",
							description: "Probe endpoint",
							subagent_type: "notebook-coder",
							pair: false,
						});
					case 1:
						noteId = textOf(context.messages.at(-1)).match(/Saved learning ([a-f0-9]{12})/)?.[1] ?? "";
						return call("revisit_note", { id: noteId });
					case 2:
						recalledAddresses = [...textOf(context.messages.at(-1)).matchAll(/notebook source ([^\]\s]+)/g)].map(
							(match) => match[1],
						);
						return call("update_notebook", {
							reflections: [{ content: curatedLearning, sourceEntryIds: recalledAddresses, supersedes: [noteId] }],
						});
					default:
						curation = textOf(context.messages.at(-1));
						noteId = curation.match(/\b[a-f0-9]{12}\b/)?.[0] ?? "";
						return fauxAssistantMessage("Discovery curated from recalled evidence.");
				}
			},
			["agent", "revisit_note", "update_notebook"],
			{ cwd, sessionManager: manager },
		);
		roots.push(root);
		await root.session.prompt("Run a temporary endpoint investigation.");
		expect(sourceIds).toHaveLength(2);
		expect(childRecall).toContain("CHILD_ONLY_COMMAND_RESULT");
		expect(recalledAddresses).toHaveLength(2);
		expect(curation).toContain(curatedLearning);
		expect(curation).not.toContain("rejected");
		expect(childRecall).toContain("Child notebook-coder");
		const archive = JSON.stringify(root.session.sessionManager.getEntries());
		expect(archive).not.toContain("UNCITED_CHILD_SECRET");
		const sessionFile = root.session.sessionFile!;
		await root.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		root.dispose();
		const reopened = await fauxSession(
			[installPair],
			[call("revisit_note", { id: noteId }), fauxAssistantMessage("Recalled.")],
			["revisit_note"],
			{ cwd, sessionManager: SessionManager.open(sessionFile) },
		);
		roots.push(reopened);
		await reopened.session.prompt("Recall the archived learning after disposing the child.");
		const result = reopened.session.messages.findLast((message) => message.role === "toolResult");
		expect(textOf(result)).toContain(`[${noteId}] ${curatedLearning}`);
		expect(textOf(result)).toContain("printf");
		expect(textOf(result)).toContain("Tool result: bash");
		expect(textOf(result)).toContain("CHILD_ONLY_COMMAND_RESULT");
		expect(textOf(result)).toContain("Child notebook-coder");
		expect(textOf(result)).not.toContain("UNCITED_CHILD_SECRET");
	}, 30_000);
});
