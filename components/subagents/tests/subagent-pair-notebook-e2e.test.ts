import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import installPair from "../../pair-programmer/src/extension.js";
import installSubagents from "../src/index.js";

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "apple-pi-pair-notebook-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
mkdirSync(join(agentDir, "agents"));
// The pair runs on the same scripted model as the sessions it follows.
writeFileSync(
	join(agentDir, "model-profiles.json"),
	JSON.stringify({ profiles: { pair: { model: "faux-session-provider/faux-session-model", thinking: "off" } } }),
);
writeFileSync(
	join(agentDir, "agents", "paired-coder.md"),
	"---\nname: paired-coder\ndescription: Paired coding fixture\ntools: read, write, bash\npair: true\nskills: false\npersist_session: false\n---\n\nPaired coding child.\n",
);

writeFileSync(
	join(agentDir, "agents", "delegating-parent.md"),
	"---\nname: delegating-parent\ndescription: Nested delegation fixture\ntools: read\npair: false\nskills: false\npersist_session: false\nallowed_subagents: paired-leaf\n---\n\nDelegating parent child.\n",
);
writeFileSync(
	join(agentDir, "agents", "paired-leaf.md"),
	"---\nname: paired-leaf\ndescription: Nested paired coding fixture\ntools: write, bash\npair: true\nskills: false\npersist_session: false\n---\n\nPaired coding child.\n",
);

const roots: Awaited<ReturnType<typeof fauxSession>>[] = [];
afterEach(async () => {
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

function call(name: string, args: Parameters<typeof fauxToolCall>[1]) {
	return fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
}

function deferred<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

const isPairRequest = (context: Context) =>
	getCurrentSystemPrompt(context.messages).includes("pair-programming partnership");
/** Only the primary pair's seed quotes the root conversation, whose user turns carry this marker. */
const ROOT_DIRECTION = "ROOT_DIRECTION";
const isPrimaryPair = (context: Context) => textOf(context.messages.find((message) => message.role === "user")).includes(ROOT_DIRECTION);
const isCodingChildRequest = (context: Context) =>
	getCurrentSystemPrompt(context.messages).includes("Paired coding child.");
const isCompletionPhase = (context: Context) => textOf(context.messages.at(-1)).startsWith("Before you hand off");

describe("coding-child pair shared notebook through real interactive sessions", () => {
	it("lets a paired coding child's pair read a current primary learning and recall its primary sources", async () => {
		const pairDone = deferred();
		let rootStep = 0;
		let childStep = 0;
		let pairStep = 0;
		let primaryNoteId = "";
		let pairRead = "";
		let pairRecall = "";
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				if (isPairRequest(context)) {
					if (isPrimaryPair(context)) return fauxAssistantMessage("Nothing to add.");
					switch (pairStep++) {
						case 0:
							return call("read_notebook", {});
						case 1:
							pairRead = textOf(context.messages.at(-1));
							return call("revisit_note", { id: primaryNoteId });
						default:
							if (pairStep === 3) {
								pairRecall = textOf(context.messages.at(-1));
								pairDone.resolve();
							}
							return fauxAssistantMessage("Nothing to add.");
					}
				}
				if (isCodingChildRequest(context)) {
					if (isCompletionPhase(context))
						return pairDone.promise.then(() => fauxAssistantMessage("Probe complete; reviewed and handed off."));
					if (childStep++ === 0) return call("bash", { command: "printf 'CHILD_ONLY_RESULT\\n'" });
					return fauxAssistantMessage("Probe done.");
				}
				switch (rootStep++) {
					case 0:
						return call("update_notebook", {
							reflections: [{ content: "The staging port moved to 7443; connect there instead of 443." }],
						});
					case 1:
						primaryNoteId = textOf(context.messages.at(-1)).match(/\b[a-f0-9]{12}\b/)?.[0] ?? "";
						return call("agent", {
							prompt: "Probe the staging endpoint.",
							description: "Probe endpoint",
							subagent_type: "paired-coder",
							run_in_background: true,
						});
					default:
						return fauxAssistantMessage("Primary waiting.");
				}
			},
			["agent", "update_notebook", "revisit_note"],
		);
		roots.push(root);
		await root.session.prompt(`${ROOT_DIRECTION}: PRIMARY_SOURCE_MARKER staging now answers on 7443.`);
		expect(primaryNoteId).toMatch(/^[a-f0-9]{12}$/);
		await pairDone.promise;
		expect(pairRead).toContain(`[${primaryNoteId}] The staging port moved to 7443`);
		expect(pairRecall).toContain(`[${primaryNoteId}] The staging port moved to 7443`);
		expect(pairRecall).toContain("PRIMARY_SOURCE_MARKER");
	}, 30_000);

	it("commits a coding child's pair learning with original child evidence before the child finishes and keeps it after stop", async () => {
		const pairAdded = deferred();
		let rootStep = 0;
		let childStep = 0;
		let pairStep = 0;
		let agentId = "";
		let pairNoteId = "";
		let pairReceipt = "";
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				if (isPairRequest(context)) {
					if (isPrimaryPair(context) || pairStep > 1) return fauxAssistantMessage("Nothing to add.");
					if (pairStep++ === 0) {
						// The child's bash call and its result are the last two sources of its first turn.
						const sourceEntryIds = [
							...textOf(context.messages.at(-1)).matchAll(/\[Source entry id: ([^\]]+)\]/g),
						]
							.map((match) => match[1])
							.slice(-2);
						return call("update_notebook", {
							reflections: [
								{
									content: "The probe only answers through printf on this host; reuse that probe.",
									sourceEntryIds,
								},
							],
						});
					}
					pairReceipt = textOf(context.messages.at(-1));
					pairNoteId = pairReceipt.match(/\b[a-f0-9]{12}\b/)?.[0] ?? "";
					pairAdded.resolve();
					return fauxAssistantMessage("Nothing to add.");
				}
				if (isCodingChildRequest(context)) {
					// The invocation stays unfinished until the primary stops it.
					if (isCompletionPhase(context)) return "until-aborted";
					if (childStep++ === 0) return call("bash", { command: "printf 'CHILD_ONLY_RESULT\\n'" });
					return fauxAssistantMessage("Probe done.");
				}
				switch (rootStep++) {
					case 0:
						return call("agent", {
							prompt: "Probe the staging endpoint.",
							description: "Probe endpoint",
							subagent_type: "paired-coder",
							run_in_background: true,
						});
					case 1:
						agentId = textOf(context.messages.at(-1)).match(/Agent ID: ([a-f0-9-]+)/)?.[1] ?? "";
						return fauxAssistantMessage("Primary waiting.");
					case 2:
					case 6:
						return call("revisit_note", { id: pairNoteId });
					case 4:
						return call("stop_subagent", { agent_id: agentId });
					default:
						return fauxAssistantMessage(textOf(context.messages.at(-1)));
				}
			},
			["agent", "revisit_note", "stop_subagent"],
		);
		roots.push(root);
		await root.session.prompt(`${ROOT_DIRECTION}: delegate the staging probe.`);
		await pairAdded.promise;
		expect(pairReceipt).toContain("Notebook updated");
		for (const moment of ["while the child works", "after stopping the child"]) {
			if (moment !== "while the child works") {
				await root.session.prompt(`${ROOT_DIRECTION}: stop the child.`);
				expect(root.session.getLastAssistantText()).toContain(`Stopped subagent ${agentId}`);
			}
			await root.session.prompt(`${ROOT_DIRECTION}: recall the pair's learning ${moment}.`);
			const recalled = root.session.getLastAssistantText() ?? "";
			expect(recalled).toContain(`[${pairNoteId}] The probe only answers through printf`);
			expect(recalled).toMatch(/\[Child paired-coder [^\n]*\]\n\[Tool result: bash [^\n]*\]: CHILD_ONLY_RESULT/);
		}
	}, 30_000);

	it("keeps a coding child's pair add-only while the primary retains curation", async () => {
		const pairDone = deferred();
		let rootStep = 0;
		let childStep = 0;
		let pairStep = 0;
		let primaryNoteId = "";
		let pairNoteId = "";
		let rejected: boolean[] = [];
		let afterAttempts = "";
		let curation = "";
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				if (isPairRequest(context)) {
					if (isPrimaryPair(context) || pairStep > 3) return fauxAssistantMessage("Nothing to add.");
					switch (pairStep++) {
						case 0:
							return call("update_notebook", {
								reflections: [
									{
										content: "The probe needs printf; plain echo dropped the marker.",
										sourceEntryIds: [
											...textOf(context.messages.at(-1)).matchAll(/\[Source entry id: ([^\]]+)\]/g),
										].map((match) => match[1]),
									},
								],
							});
						case 1:
							pairNoteId = textOf(context.messages.at(-1)).match(/\b[a-f0-9]{12}\b/)?.[0] ?? "";
							return fauxAssistantMessage(
								[
									fauxToolCall("update_notebook", { reflections: [], retireReflectionIds: [primaryNoteId] }),
									fauxToolCall("update_notebook", { reflections: [], retainReflectionIds: [] }),
									fauxToolCall("update_notebook", {
										reflections: [
											{
												content: "Replace the primary learning.",
												sourceEntryIds: [pairNoteId],
												supersedes: [primaryNoteId],
											},
										],
									}),
								],
								{ stopReason: "toolUse" },
							);
						case 2:
							rejected = context.messages
								.filter((message) => message.role === "toolResult")
								.slice(-3)
								.map((message) => message.role === "toolResult" && message.isError);
							return call("read_notebook", {});
						default:
							afterAttempts = textOf(context.messages.at(-1));
							pairDone.resolve();
							return fauxAssistantMessage("Nothing to add.");
					}
				}
				if (isCodingChildRequest(context)) {
					if (isCompletionPhase(context))
						return pairDone.promise.then(() => fauxAssistantMessage("Probe complete; reviewed and handed off."));
					if (childStep++ === 0) return call("bash", { command: "printf 'CHILD_ONLY_RESULT\\n'" });
					return fauxAssistantMessage("Probe done.");
				}
				switch (rootStep++) {
					case 0:
						return call("update_notebook", {
							reflections: [{ content: "The staging port moved to 7443; connect there instead of 443." }],
						});
					case 1:
						primaryNoteId = textOf(context.messages.at(-1)).match(/\b[a-f0-9]{12}\b/)?.[0] ?? "";
						return call("agent", {
							prompt: "Probe the staging endpoint.",
							description: "Probe endpoint",
							subagent_type: "paired-coder",
						});
					case 2:
						return fauxAssistantMessage("Child finished.");
					case 3:
						return call("update_notebook", {
							reflections: [
								{ content: "Probe staging on 7443 with printf; echo drops the marker.", supersedes: [pairNoteId] },
							],
							retireReflectionIds: [primaryNoteId],
						});
					default:
						curation = textOf(context.messages.at(-1));
						return fauxAssistantMessage("Curated.");
				}
			},
			["agent", "update_notebook", "revisit_note"],
		);
		roots.push(root);
		await root.session.prompt(`${ROOT_DIRECTION}: PRIMARY_SOURCE_MARKER staging now answers on 7443.`);
		expect(pairNoteId).toMatch(/^[a-f0-9]{12}$/);
		expect(rejected).toEqual([true, true, true]);
		expect(afterAttempts).toContain(`[${primaryNoteId}] The staging port moved to 7443`);
		expect(afterAttempts).toContain(`[${pairNoteId}] The probe needs printf`);
		expect(afterAttempts).not.toContain("Replace the primary learning.");
		await root.session.prompt(`${ROOT_DIRECTION}: merge the pair's learning into the port learning.`);
		expect(curation).toContain("Probe staging on 7443 with printf");
		expect(curation).toContain("2 retirements");
	}, 30_000);

	it("gives a nested coding child's pair the same primary notebook read, recall, and addition", async () => {
		const pairDone = deferred();
		let rootStep = 0;
		let parentStep = 0;
		let leafStep = 0;
		let pairStep = 0;
		let primaryNoteId = "";
		let pairNoteId = "";
		let pairRead = "";
		let pairRecall = "";
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				if (isPairRequest(context)) {
					if (isPrimaryPair(context) || pairStep > 3) return fauxAssistantMessage("Nothing to add.");
					switch (pairStep++) {
						case 0:
							return call("read_notebook", {});
						case 1:
							pairRead = textOf(context.messages.at(-1));
							return call("revisit_note", { id: primaryNoteId });
						case 2:
							pairRecall = textOf(context.messages.at(-1));
							return call("update_notebook", {
								reflections: [
									{
										content: "The nested probe needs printf; reuse it when retrying.",
										sourceEntryIds: [
											...context.messages
												.filter((message) => message.role === "user")
												.map(textOf)
												.join("\n")
												.matchAll(/\[Source entry id: ([^\]]+)\]/g),
										]
											.map((match) => match[1])
											.slice(-2),
									},
								],
							});
						default:
							pairNoteId = textOf(context.messages.at(-1)).match(/\b[a-f0-9]{12}\b/)?.[0] ?? "";
							pairDone.resolve();
							return fauxAssistantMessage("Nothing to add.");
					}
				}
				const system = getCurrentSystemPrompt(context.messages);
				if (system.includes("Delegating parent child.")) {
					if (parentStep++ === 0)
						return call("agent", {
							prompt: "Probe the nested endpoint.",
							description: "Nested probe",
							subagent_type: "paired-leaf",
						});
					return fauxAssistantMessage("Nested probe delegated.");
				}
				if (isCodingChildRequest(context)) {
					if (isCompletionPhase(context)) return "until-aborted";
					if (leafStep++ === 0) return call("bash", { command: "printf 'NESTED_ONLY_RESULT\\n'" });
					return fauxAssistantMessage("Nested probe done.");
				}
				switch (rootStep++) {
					case 0:
						return call("update_notebook", {
							reflections: [{ content: "The staging port moved to 7443; connect there instead of 443." }],
						});
					case 1:
						primaryNoteId = textOf(context.messages.at(-1)).match(/\b[a-f0-9]{12}\b/)?.[0] ?? "";
						return call("agent", {
							prompt: "Delegate the nested probe.",
							description: "Delegate probe",
							subagent_type: "delegating-parent",
							run_in_background: true,
						});
					case 2:
						return fauxAssistantMessage("Primary waiting.");
					case 3:
						return call("revisit_note", { id: pairNoteId });
					default:
						return fauxAssistantMessage(textOf(context.messages.at(-1)));
				}
			},
			["agent", "update_notebook", "revisit_note"],
		);
		roots.push(root);
		await root.session.prompt(`${ROOT_DIRECTION}: PRIMARY_SOURCE_MARKER staging now answers on 7443.`);
		await pairDone.promise;
		expect(pairRead).toContain(`[${primaryNoteId}] The staging port moved to 7443`);
		expect(pairRecall).toContain("PRIMARY_SOURCE_MARKER");
		expect(pairNoteId).toMatch(/^[a-f0-9]{12}$/);
		await root.session.prompt(`${ROOT_DIRECTION}: recall the nested pair's learning while the leaf works.`);
		expect(root.session.getLastAssistantText()).toContain(`[${pairNoteId}] The nested probe needs printf`);
		expect(root.session.getLastAssistantText()).toMatch(
			/\[Child paired-leaf [^\n]*\]\n\[Tool result: bash [^\n]*\]: NESTED_ONLY_RESULT/,
		);
	}, 30_000);

	it("rejects a coding child's pair addition in a fresh review after the primary navigates away", async () => {
		const accepted = deferred();
		const lateReviewed = deferred();
		const releaseChild = deferred();
		let rootStep = 0;
		let childStep = 0;
		let pairStep = 0;
		let lateResult: { isError?: boolean; text: string } | undefined;
		const sources = (context: Context) =>
			[...textOf(context.messages.at(-1)).matchAll(/\[Source entry id: ([^\]]+)\]/g)].map((match) => match[1]);
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				if (isPairRequest(context)) {
					if (isPrimaryPair(context)) return fauxAssistantMessage("Nothing to add.");
					const latest = context.messages.at(-1);
					console.error("PAIR", pairStep, latest?.role, textOf(latest).slice(0, 200));
					if (latest?.role === "toolResult") {
						if (pairStep === 1) accepted.resolve();
						else if (pairStep === 2) {
							lateResult = { isError: latest.isError, text: textOf(latest) };
							lateReviewed.resolve();
						}
						return fauxAssistantMessage("Nothing to add.");
					}
					if (!textOf(latest).includes("LATE_ONLY_RESULT") && pairStep > 0)
						return fauxAssistantMessage("Nothing to add.");
					pairStep++;
					return call("update_notebook", {
						reflections: [
							{
								content:
									pairStep === 1
										? "The probe needs printf on this host; reuse it."
										: "STALE_PAIR_WRITE must not reach the replaced branch.",
								sourceEntryIds: sources(context).slice(-2),
							},
						],
					});
				}
				if (isCodingChildRequest(context)) {
					console.error("CHILD", childStep, textOf(context.messages.at(-1)).slice(0, 80));
					switch (childStep++) {
						case 0:
							return call("bash", { command: "printf 'CHILD_ONLY_RESULT\\n'" });
						case 1:
							return fauxAssistantMessage("Probe done.");
						case 2:
							return releaseChild.promise.then(() => call("bash", { command: "printf 'LATE_ONLY_RESULT\\n'" }));
						default:
							return fauxAssistantMessage("Late probe done.");
					}
				}
				switch (rootStep++) {
					case 0:
						return fauxAssistantMessage("Navigation anchor ready.");
					case 1:
						return call("agent", {
							prompt: "Probe the staging endpoint.",
							description: "Probe endpoint",
							subagent_type: "paired-coder",
							run_in_background: true,
						});
					default:
						return fauxAssistantMessage("Primary waiting.");
				}
			},
			["agent"],
		);
		roots.push(root);
		await root.session.prompt(`${ROOT_DIRECTION}: establish a branch point.`);
		const anchor = root.session.getUserMessagesForForking()[0].entryId;
		await root.session.prompt(`${ROOT_DIRECTION}: delegate the staging probe.`);
		await accepted.promise;
		const navigation = await root.session.navigateTree(anchor, { summarize: false });
		expect(navigation.cancelled).toBe(false);
		await root.session.prompt(`${ROOT_DIRECTION}: continue on the replacement branch.`);
		releaseChild.resolve();
		await lateReviewed.promise;
		expect(lateResult?.isError).toBe(true);
		expect(lateResult?.text).toContain("branch changed");
		expect(JSON.stringify(root.session.sessionManager.getEntries())).not.toContain("STALE_PAIR_WRITE");
		expect(JSON.stringify(root.session.sessionManager.getEntries())).not.toContain("LATE_ONLY_RESULT");
	}, 30_000);
});
