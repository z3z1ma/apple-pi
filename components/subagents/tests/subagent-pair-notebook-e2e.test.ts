import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
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
const directories: string[] = [];
afterEach(async () => {
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
const isPrimaryPair = (context: Context) =>
	textOf(context.messages.find((message) => message.role === "user")).includes(ROOT_DIRECTION);
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
		let pairInstructions = "";
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				if (isPairRequest(context)) {
					if (isPrimaryPair(context)) return fauxAssistantMessage("Nothing to add.");
					switch (pairStep++) {
						case 0:
							pairInstructions = getCurrentSystemPrompt(context.messages);
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
		// The child's pair learns add-only shared access, not the primary pair's maintenance contract.
		for (const tool of ["read_notebook", "expand_receipt", "revisit_note", "update_notebook"])
			expect(pairInstructions).toContain(`\`${tool}\``);
		expect(pairInstructions).toContain("add-only");
		for (const curation of ["retainReflectionIds", "supersedes", "Time to update the shared notebook"])
			expect(pairInstructions).not.toContain(curation);
	}, 30_000);

	it("commits a coding child's pair learning with original child evidence before the child finishes and keeps it after disposal", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "apple-pi-pair-archive-"));
		directories.push(cwd);
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
						const sourceEntryIds = [...textOf(context.messages.at(-1)).matchAll(/\[Source entry id: ([^\]]+)\]/g)]
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
			{ cwd, sessionManager: SessionManager.create(cwd, join(cwd, "sessions")) },
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
		// Shutdown disposes the ephemeral child and its pair; the primary archive alone answers recall.
		const sessionFile = root.session.sessionFile!;
		roots.splice(roots.indexOf(root), 1);
		await root.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		root.dispose();
		const reopened = await fauxSession(
			[installPair],
			[call("revisit_note", { id: pairNoteId }), fauxAssistantMessage("Recalled.")],
			["revisit_note"],
			{ cwd, sessionManager: SessionManager.open(sessionFile) },
		);
		roots.push(reopened);
		await reopened.session.prompt("Recall the pair's learning after the child is gone.");
		const archived = textOf(reopened.session.messages.findLast((message) => message.role === "toolResult"));
		expect(archived).toContain(`[${pairNoteId}] The probe only answers through printf`);
		expect(archived).toMatch(/\[Child paired-coder [^\n]*\]\n\[Tool result: bash [^\n]*\]: CHILD_ONLY_RESULT/);
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
										sourceEntryIds: [...textOf(context.messages.at(-1)).matchAll(/\[Source entry id: ([^\]]+)\]/g)].map(
											(match) => match[1],
										),
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

	it("shows a coding child's pair a primary learning recorded while that child is already running", async () => {
		const firstReview = deferred();
		const releaseChild = deferred();
		const freshRead = deferred<string>();
		let rootStep = 0;
		let childStep = 0;
		let reads = 0;
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				if (isPairRequest(context)) {
					if (isPrimaryPair(context)) return fauxAssistantMessage("Nothing to add.");
					const latest = context.messages.at(-1);
					if (latest?.role === "toolResult") {
						freshRead.resolve(textOf(latest));
						return fauxAssistantMessage("Nothing to add.");
					}
					if (textOf(latest).includes("SECOND_PROBE") && reads++ === 0) return call("read_notebook", {});
					firstReview.resolve();
					return fauxAssistantMessage("Nothing to add.");
				}
				if (isCodingChildRequest(context)) {
					switch (childStep++) {
						case 0:
							return call("bash", { command: "printf 'FIRST_PROBE\\n'" });
						case 1:
							return fauxAssistantMessage("First probe done.");
						case 2:
							// The completion phase keeps this invocation running while the primary learns something new.
							return releaseChild.promise.then(() => call("bash", { command: "printf 'SECOND_PROBE\\n'" }));
						case 3:
							return fauxAssistantMessage("Second probe done.");
						default:
							return "until-aborted";
					}
				}
				switch (rootStep++) {
					case 0:
						return call("agent", {
							prompt: "Probe the staging endpoint twice.",
							description: "Probe endpoint",
							subagent_type: "paired-coder",
							run_in_background: true,
						});
					case 1:
						return fauxAssistantMessage("Primary waiting.");
					case 2:
						return call("update_notebook", {
							reflections: [{ content: "LIVE_PRIMARY_LEARNING: staging now needs the 7443 port." }],
						});
					default:
						return fauxAssistantMessage("Recorded while the child works.");
				}
			},
			["agent", "update_notebook"],
		);
		roots.push(root);
		await root.session.prompt(`${ROOT_DIRECTION}: delegate the staging probes.`);
		await firstReview.promise;
		await root.session.prompt(`${ROOT_DIRECTION}: record the port change discovered meanwhile.`);
		expect(root.session.getLastAssistantText()).toBe("Recorded while the child works.");
		releaseChild.resolve();
		expect(await freshRead.promise).toContain("LIVE_PRIMARY_LEARNING: staging now needs the 7443 port.");
	}, 30_000);
});
