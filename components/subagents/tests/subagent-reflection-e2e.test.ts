import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import { type ExtensionAPI, SessionManager } from "@earendil-works/pi-coding-agent";
import { resumeAgent } from "../src/agent-runner.js";
import compactionSafety from "../../../extensions/compaction-safety.js";
import installPair from "../../pair-programmer/src/extension.js";
import { registerCompletionReflection } from "../src/completion-reflection.js";
import installSubagents from "../src/index.js";

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "apple-pi-reflection-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
mkdirSync(join(agentDir, "agents"));
writeFileSync(join(agentDir, ".pair-state.json"), JSON.stringify({ enabled: false }));
writeFileSync(
	join(agentDir, "agents", "reflection-coder.md"),
	"---\nname: reflection-coder\ndescription: Custom coding fixture\ntools: read, edit, write, bash\npair: false\nskills: false\npersist_session: false\n---\n\nCustom coding child.\n",
);

writeFileSync(
	join(agentDir, "agents", "reflection-limited.md"),
	"---\nname: reflection-limited\ndescription: Turn-limited coding fixture\ntools: read, edit, write, bash\nmax_turns: 2\npair: false\nskills: false\npersist_session: false\n---\n\nCustom coding child.\n",
);
writeFileSync(
	join(agentDir, "agents", "reflection-lead.md"),
	"---\nname: reflection-lead\ndescription: Nested coding fixture\ntools: read, write, bash\nallowed_subagents: reflection-coder\npair: false\nskills: false\npersist_session: false\n---\n\nLead coding child.\n",
);
for (const [name, tools] of [
	["reflection-advisor", "tools: read, bash"],
	["reflection-restricted", "tools: read, edit, write, bash\ndisallowed_tools: edit, write"],
]) {
	writeFileSync(
		join(agentDir, "agents", `${name}.md`),
		`---\nname: ${name}\ndescription: Non-editing fixture\n${tools}\npair: false\nskills: false\npersist_session: false\n---\n\nNon-editing child.\n`,
	);
}

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

function call(name: string, args: Parameters<typeof fauxToolCall>[1]): Reply {
	return fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
}

function gate() {
	let open!: () => void;
	const opened = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { open, opened };
}

const isChild = (context: Parameters<Exclude<Parameters<typeof fauxSession>[1], Reply[]>>[0]) =>
	getCurrentSystemPrompt(context.messages).includes("Custom coding child.");

describe("coding-child completion reflection through real interactive sessions", () => {
	it.each(["error", "length", "stop"] as const)(
		"retains the resumed report after an empty %s reflection following automatic compaction",
		async (stopReason) => {
			const manager = SessionManager.inMemory();
			for (let turn = 0; turn < 8; turn++) {
				manager.appendMessage({
					role: "user",
					content: [{ type: "text", text: `Prior task ${turn}. ${"prior context ".repeat(20_000)}` }],
					timestamp: turn,
				});
				const old = fauxAssistantMessage("Prior invocation complete.");
				manager.appendMessage(old);
			}
			const kept = manager.getLeafId()!;
			let compactions = 0;
			let step = 0;
			const root = await fauxSession(
				[
					registerCompletionReflection,
					(pi) => {
						pi.on("session_before_compact", (event) => {
							compactions++;
							return {
								compaction: {
									summary: "Earlier tasks completed; continue the resumed assignment.",
									firstKeptEntryId: kept,
									tokensBefore: event.preparation.tokensBefore,
								},
							};
						});
					},
				],
				() =>
					step++ === 0
						? fauxAssistantMessage("Resumed preliminary report: available work is retained.")
						: fauxAssistantMessage("", {
								stopReason,
								errorMessage: "Reflection provider failed after compaction",
							}),
				["write"],
				{ sessionManager: manager },
			);
			roots.push(root);
			root.session.settingsManager.setCompactionEnabled(true);
			const result = await resumeAgent(root.session, "Continue this assignment.");
			expect(compactions).toBe(1);
			expect(result.failure).toBeTruthy();
			expect(result.text).toContain("Resumed preliminary report: available work is retained.");
			expect(result.text).toContain("automatic completion review did not finish");
			expect(result.text).not.toContain("Prior invocation complete.");
		},
	);

	it("retains the reviewed report when failed automatic compaction rejects the SDK prompt", async () => {
		const manager = SessionManager.inMemory();
		manager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "prior context ".repeat(20_000) }],
			timestamp: 0,
		});
		manager.appendMessage(fauxAssistantMessage("Prior invocation complete."));
		let step = 0;
		let compactions = 0;
		const root = await fauxSession(
			[
				registerCompletionReflection,
				compactionSafety,
				(pi) => {
					pi.on("session_before_compact", () => {
						compactions++;
						return { cancel: true };
					});
				},
			],
			() => {
				if (step++ === 0) return fauxAssistantMessage("Preliminary report: work remains available.");
				return fauxAssistantMessage(
					`Final reviewed report: available work and checks retained. ${"reviewed context ".repeat(30_000)}`,
				);
			},
			["write"],
			{ sessionManager: manager },
		);
		roots.push(root);
		root.session.settingsManager.setCompactionEnabled(true);
		const result = await resumeAgent(root.session, "Continue the assignment.");
		expect(compactions).toBe(1);
		expect(result.failure).toContain("Automatic compaction failed or was cancelled");
		expect(result.text).toContain("Final reviewed report: available work and checks retained.");
		expect(result.text).not.toContain("automatic completion review did not finish");
	});

	it("keeps the handoff pending until the in-band review revalidates the final artifact", async () => {
		const release = gate();
		let childStep = 0;
		let rootStep = 0;
		let agentId = "";
		let instruction = "";
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				if (isChild(context)) {
					switch (childStep++) {
						case 0:
							return call("write", { path: "src/feature.ts", content: "export const answer = 1;\n" });
						case 1:
							return fauxAssistantMessage("Preliminary report: answer is 1.");
						case 2:
							instruction = textOf(context.messages.at(-1));
							return release.opened.then(() =>
								call("edit", { path: "src/feature.ts", edits: [{ oldText: "1", newText: "42" }] }),
							);
						case 3:
							return call("bash", { command: "cat src/feature.ts" });
						default:
							return fauxAssistantMessage("Final report: answer is 42; `cat src/feature.ts` ran after the last edit.");
					}
				}
				switch (rootStep++) {
					case 0:
						return call("agent", {
							prompt: "Implement the answer.",
							description: "Implement answer",
							subagent_type: "reflection-coder",
							run_in_background: true,
						});
					case 1:
						agentId = textOf(context.messages.at(-1)).match(/Agent ID: ([a-f0-9-]+)/)?.[1] ?? "";
						return fauxAssistantMessage("Launched.");
					case 2:
						return call("get_subagent_result", { agent_id: agentId, yield_seconds: 0, verbose: false });
					case 4:
						release.open();
						return call("get_subagent_result", { agent_id: agentId, verbose: false });
					default:
						return fauxAssistantMessage(textOf(context.messages.at(-1)));
				}
			},
			["agent", "get_subagent_result"],
		);
		roots.push(root);
		await root.session.prompt("Delegate the implementation.");
		await vi.waitFor(() => expect(instruction).toContain("Review your changes"), { timeout: 10_000 });
		await root.session.prompt("Check the child while its review runs.");
		expect(root.session.getLastAssistantText()).toContain("is running");
		expect(root.session.getLastAssistantText()).not.toContain("Preliminary report");
		await root.session.prompt("Collect the result.");
		const handoff = root.session.getLastAssistantText() ?? "";
		expect(instruction).toContain("Review your changes in `src/feature.ts`");
		expect(instruction).toContain("Nothing ran after your last change to `src/feature.ts`.");
		expect(handoff).toContain("Final report: answer is 42");
		expect(handoff).not.toContain("Preliminary report");
		expect(handoff).toContain("src/feature.ts");
		expect(readFileSync(join(root.cwd, "src/feature.ts"), "utf8")).toBe("export const answer = 42;\n");
	}, 30_000);

	it("reviews every changed kind and captures learning in one continuation without a pair", async () => {
		let childStep = 0;
		let rootStep = 0;
		let noteId = "";
		const instructions: string[] = [];
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				if (isChild(context)) {
					const last = context.messages.at(-1);
					if (last?.role === "user" && textOf(last).includes("Before you hand off")) instructions.push(textOf(last));
					switch (childStep++) {
						case 0:
							return fauxAssistantMessage(
								[
									fauxToolCall("write", { path: "tests/feature.test.ts", content: "test\n" }),
									fauxToolCall("write", { path: "src/feature.ts", content: "code\n" }),
									fauxToolCall("write", { path: "docs/feature.md", content: "# Feature\n" }),
								],
								{ stopReason: "toolUse" },
							);
						case 1:
							return call("bash", { command: "false" });
						case 2:
							return fauxAssistantMessage("Preliminary report.");
						case 3:
							return call("update_notebook", {
								reflections: [{ content: "The fixture check fails until seeded; seed it before running." }],
							});
						default:
							noteId = textOf(context.messages.at(-1)).match(/\b[a-f0-9]{12}\b/)?.[0] ?? "";
							return fauxAssistantMessage("Final report with review status and one learning recorded.");
					}
				}
				switch (rootStep++) {
					case 0:
						return call("agent", {
							prompt: "Implement the feature with tests and docs.",
							description: "Implement feature",
							subagent_type: "reflection-coder",
							pair: false,
						});
					case 1:
						return call("revisit_note", { id: noteId });
					default:
						return fauxAssistantMessage(textOf(context.messages.at(-1)));
				}
			},
			["agent", "revisit_note"],
		);
		roots.push(root);
		await root.session.prompt("Delegate the feature.");
		expect(instructions).toHaveLength(1);
		const [instruction] = instructions;
		expect(instruction).toContain("Review the tests you changed in `tests/feature.test.ts`");
		expect(instruction).toContain("Review your changes in `src/feature.ts`");
		expect(instruction).toContain("Read your changes in `docs/feature.md` as their intended reader");
		expect(instruction).toContain("After your last change to `src/feature.ts`, these ran: `false` (failed).");
		expect(instruction).toContain("Record each learning with `update_notebook`");
		expect(instruction).toContain("bash: `false`");
		expect(instruction).toContain("ask with `clarify` if you have it; its answer is advice, not new authorization");
		expect(instruction).toContain("leave the disputed change alone and report the question");
		expect(instruction.indexOf("Review the tests")).toBeLessThan(instruction.indexOf("Record each learning"));
		expect(root.session.getLastAssistantText()).toContain(`[${noteId}] The fixture check fails until seeded`);
	}, 30_000);

	it("reflects on learning without a review task when no built-in edit succeeded", async () => {
		let childStep = 0;
		let rootStep = 0;
		const instructions: string[] = [];
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				if (isChild(context)) {
					const last = context.messages.at(-1);
					if (last?.role === "user" && textOf(last).includes("Before you hand off")) instructions.push(textOf(last));
					switch (childStep++) {
						case 0:
							return call("edit", { path: "missing.ts", edits: [{ oldText: "a", newText: "b" }] });
						case 1:
							return fauxAssistantMessage("Preliminary inspection.");
						default:
							return fauxAssistantMessage("Final inspection report; nothing worth recording.");
					}
				}
				if (rootStep++ === 0)
					return call("agent", {
						prompt: "Inspect the missing module.",
						description: "Inspect",
						subagent_type: "reflection-coder",
					});
				return fauxAssistantMessage(textOf(context.messages.at(-1)));
			},
			["agent"],
		);
		roots.push(root);
		await root.session.prompt("Delegate the inspection.");
		expect(instructions).toHaveLength(1);
		expect(instructions[0]).toContain("Record each learning with `update_notebook`");
		expect(instructions[0]).toContain("edit: `missing.ts`");
		expect(instructions[0]).not.toContain("Review your changes");
		expect(instructions[0]).not.toContain("ran after");
		expect(instructions[0]).toContain("no change review was due because no built-in edit or write succeeded");
		expect(instructions[0]).toContain("what stays unverified");
		expect(root.session.getLastAssistantText()).toContain("Final inspection report");
	}, 30_000);

	it("schedules one pass per invocation, including a resume, and review edits do not trigger another", async () => {
		let rootStep = 0;
		let agentId = "";
		const instructions: string[] = [];
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				if (isChild(context)) {
					const last = context.messages.at(-1);
					const lastText = textOf(last);
					if (last?.role === "user" && lastText.includes("Before you hand off")) {
						instructions.push(lastText);
						const path = instructions.length === 1 ? "src/a.ts" : "src/b.ts";
						return call("edit", { path, edits: [{ oldText: "1", newText: "2" }] });
					}
					if (last?.role === "user")
						return call("write", {
							path: lastText.includes("first") ? "src/a.ts" : "src/b.ts",
							content: "export const value = 1;\n",
						});
					if (last?.role === "toolResult" && last.toolName === "write") return fauxAssistantMessage("Preliminary.");
					return fauxAssistantMessage(`Final report ${instructions.length}.`);
				}
				switch (rootStep++) {
					case 0:
						return call("agent", {
							prompt: "Implement the first module.",
							description: "First",
							subagent_type: "reflection-coder",
						});
					case 1:
						agentId = textOf(context.messages.at(-1)).match(/Agent ID: ([a-f0-9-]+)/)?.[1] ?? "";
						return call("agent", {
							resume: agentId,
							prompt: "Implement the second module.",
							description: "Second",
							subagent_type: "reflection-coder",
						});
					default:
						return fauxAssistantMessage(textOf(context.messages.at(-1)));
				}
			},
			["agent"],
		);
		roots.push(root);
		await root.session.prompt("Delegate both modules.");
		expect(instructions).toHaveLength(2);
		expect(instructions[0]).toContain("Review your changes in `src/a.ts`");
		expect(instructions[1]).toContain("Review your changes in `src/b.ts`");
		expect(instructions[1]).not.toContain("src/a.ts");
		expect(root.session.getLastAssistantText()).toContain("Final report 2.");
		expect(readFileSync(join(root.cwd, "src/b.ts"), "utf8")).toBe("export const value = 2;\n");
	}, 30_000);

	it("returns a failed continuation as an ordinary failure that keeps the work and names the unfinished reflection", async () => {
		let childStep = 0;
		let rootStep = 0;
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				if (isChild(context)) {
					switch (childStep++) {
						case 0:
							return call("write", { path: "src/feature.ts", content: "export const answer = 1;\n" });
						case 1:
							return fauxAssistantMessage("Preliminary report: answer is 1.");
						default:
							return fauxAssistantMessage("", {
								stopReason: "error",
								errorMessage: "Fixture provider rejected request",
							});
					}
				}
				if (rootStep++ === 0)
					return call("agent", { prompt: "Implement.", description: "Implement", subagent_type: "reflection-coder" });
				return fauxAssistantMessage(textOf(context.messages.at(-1)));
			},
			["agent"],
		);
		roots.push(root);
		await root.session.prompt("Delegate.");
		const handoff = root.session.getLastAssistantText() ?? "";
		expect(handoff).toContain("Agent failed: Fixture provider rejected request");
		expect(handoff).toContain("Preliminary report: answer is 1.");
		expect(handoff).toContain("automatic completion review did not finish");
		expect(readFileSync(join(root.cwd, "src/feature.ts"), "utf8")).toBe("export const answer = 1;\n");
	}, 30_000);

	it("stops the in-band review through the child's provider signal, keeps the work, and lets the parent continue", async () => {
		let childStep = 0;
		let rootStep = 0;
		let agentId = "";
		let reviewSignal: AbortSignal | undefined;
		const root = await fauxSession(
			[installPair, installSubagents],
			(context, signal) => {
				if (isChild(context)) {
					switch (childStep++) {
						case 0:
							return call("write", { path: "src/feature.ts", content: "export const answer = 1;\n" });
						case 1:
							return fauxAssistantMessage("Preliminary report: answer is 1.");
						case 2:
							reviewSignal = signal;
							return "until-aborted";
						default:
							return call("write", { path: "src/feature.ts", content: "detached\n" });
					}
				}
				switch (rootStep++) {
					case 0:
						return call("agent", {
							prompt: "Implement.",
							description: "Implement",
							subagent_type: "reflection-coder",
							run_in_background: true,
						});
					case 1:
						agentId = textOf(context.messages.at(-1)).match(/Agent ID: ([a-f0-9-]+)/)?.[1] ?? "";
						return fauxAssistantMessage("Launched.");
					case 2:
						return call("stop_subagent", { agent_id: agentId });
					case 4:
						return call("get_subagent_result", { agent_id: agentId, verbose: false });
					default:
						return fauxAssistantMessage(textOf(context.messages.at(-1)));
				}
			},
			["agent", "stop_subagent", "get_subagent_result"],
		);
		roots.push(root);
		await root.session.prompt("Delegate.");
		await vi.waitFor(() => expect(reviewSignal).toBeDefined(), { timeout: 10_000 });
		await root.session.prompt("Stop the child.");
		expect(root.session.getLastAssistantText()).toContain("Stopped subagent");
		await vi.waitFor(() => expect(reviewSignal?.aborted).toBe(true));
		await root.session.prompt("Collect what the child left.");
		const handoff = root.session.getLastAssistantText() ?? "";
		expect(handoff).toContain("STOPPED BY THE USER");
		expect(handoff).toContain("Preliminary report: answer is 1.");
		expect(handoff).toContain("automatic completion review did not finish");
		expect(readFileSync(join(root.cwd, "src/feature.ts"), "utf8")).toBe("export const answer = 1;\n");
	}, 30_000);

	it("ends an in-band review that exceeds the ordinary turn ceiling as an aborted, unfinished handoff", async () => {
		let childStep = 0;
		let rootStep = 0;
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				if (isChild(context)) {
					childStep++;
					if (childStep === 1) return call("write", { path: "src/feature.ts", content: "export const answer = 1;\n" });
					if (!JSON.stringify(context.messages).includes("Before you hand off"))
						return fauxAssistantMessage("Preliminary report: answer is 1.");
					return call("bash", { command: "true" });
				}
				if (rootStep++ === 0)
					return call("agent", { prompt: "Implement.", description: "Implement", subagent_type: "reflection-limited" });
				return fauxAssistantMessage(textOf(context.messages.at(-1)));
			},
			["agent"],
		);
		roots.push(root);
		await root.session.prompt("Delegate.");
		const handoff = root.session.getLastAssistantText() ?? "";
		expect(handoff).toContain("aborted at the turn limit");
		expect(handoff).toContain("Preliminary report: answer is 1.");
		expect(handoff).toContain("automatic completion review did not finish");
		expect(readFileSync(join(root.cwd, "src/feature.ts"), "utf8")).toBe("export const answer = 1;\n");
	}, 30_000);

	it("gives each nested coding child its own phase while a clarification fork stays outside the parent's", async () => {
		let rootStep = 0;
		let leadStep = 0;
		let leafStep = 0;
		let forkRequests = 0;
		const leadInstructions: string[] = [];
		const leafInstructions: string[] = [];
		let advice = "";
		const completion = (context: { messages: Array<{ content: unknown }> }) =>
			textOf(context.messages.at(-1)).startsWith("Before you hand off");
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				const prompt = getCurrentSystemPrompt(context.messages);
				if (prompt.includes("Lead coding child.")) {
					if (JSON.stringify(context.messages).includes("Clarification question from your child agent")) {
						switch (forkRequests++) {
							case 0:
								return call("bash", { command: "echo fork-only-command" });
							case 1:
								return call("read", { path: "missing-fork-evidence.txt" });
							default:
								return fauxAssistantMessage("Keep the current behavior.");
						}
					}
					if (completion(context)) {
						leadInstructions.push(textOf(context.messages.at(-1)));
						return fauxAssistantMessage("Lead final report.");
					}
					switch (leadStep++) {
						case 0:
							return call("write", { path: "src/lead.ts", content: "export {};\n" });
						case 1:
							return call("agent", {
								prompt: "Implement the leaf.",
								description: "Leaf",
								subagent_type: "reflection-coder",
							});
						default:
							return fauxAssistantMessage("Lead preliminary.");
					}
				}
				if (isChild(context)) {
					if (completion(context)) {
						leafInstructions.push(textOf(context.messages.at(-1)));
						return fauxAssistantMessage("Leaf final report.");
					}
					switch (leafStep++) {
						case 0:
							return call("clarify", { question: "Should the leaf keep the current behavior?" });
						case 1:
							advice = textOf(context.messages.at(-1));
							return call("write", { path: "src/leaf.ts", content: "export {};\n" });
						default:
							return fauxAssistantMessage("Leaf preliminary.");
					}
				}
				if (rootStep++ === 0)
					return call("agent", { prompt: "Lead the work.", description: "Lead", subagent_type: "reflection-lead" });
				return fauxAssistantMessage(textOf(context.messages.at(-1)));
			},
			["agent"],
		);
		roots.push(root);
		await root.session.prompt("Delegate nested work.");
		expect(advice).toContain("Keep the current behavior.");
		expect(leafInstructions).toHaveLength(1);
		expect(leafInstructions[0]).toContain("Review your changes in `src/leaf.ts`");
		expect(leadInstructions).toHaveLength(1);
		expect(leadInstructions[0]).toContain("Review your changes in `src/lead.ts`");
		expect(leadInstructions[0]).not.toContain("missing-fork-evidence.txt");
		expect(leadInstructions[0]).not.toContain("fork-only-command");
		expect(root.session.getLastAssistantText()).toContain("Lead final report.");
	}, 30_000);

	it.each(["reflection-advisor", "reflection-restricted"])(
		"gives %s, which cannot use built-in edit or write, no completion phase",
		async (type) => {
			let rootStep = 0;
			const childRequests: string[] = [];
			const root = await fauxSession(
				[installPair, installSubagents],
				(context) => {
					if (getCurrentSystemPrompt(context.messages).includes("Non-editing child.")) {
						childRequests.push(textOf(context.messages.at(-1)));
						return childRequests.length === 1
							? call("bash", { command: "false" })
							: fauxAssistantMessage("Advisory findings.");
					}
					if (rootStep++ === 0)
						return call("agent", { prompt: "Investigate.", description: "Advise", subagent_type: type });
					return fauxAssistantMessage(textOf(context.messages.at(-1)));
				},
				["agent"],
			);
			roots.push(root);
			await root.session.prompt("Ask for advice.");
			expect(childRequests.some((request) => request.startsWith("Before you hand off"))).toBe(false);
			expect(root.session.getLastAssistantText()).toContain("Advisory findings.");
		},
		30_000,
	);

	it("delivers successful work when only the learning capture is rejected", async () => {
		let childStep = 0;
		let rootStep = 0;
		let instruction = "";
		let rejected = false;
		const root = await fauxSession(
			[installPair, installSubagents],
			(context) => {
				if (isChild(context)) {
					switch (childStep++) {
						case 0:
							return call("write", { path: "src/feature.ts", content: "export const answer = 1;\n" });
						case 1:
							return fauxAssistantMessage("Preliminary report.");
						case 2:
							instruction = textOf(context.messages.at(-1));
							return call("update_notebook", {
								reflections: [{ content: "Seed the fixture first.", sourceEntryIds: ["fabricated-source"] }],
							});
						default: {
							const result = context.messages.at(-1);
							rejected = result?.role === "toolResult" && result.isError;
							return fauxAssistantMessage("Final report; review kept the change; learning not recorded: rejected.");
						}
					}
				}
				if (rootStep++ === 0)
					return call("agent", { prompt: "Implement.", description: "Implement", subagent_type: "reflection-coder" });
				return fauxAssistantMessage(textOf(context.messages.at(-1)));
			},
			["agent"],
		);
		roots.push(root);
		await root.session.prompt("Delegate.");
		const handoff = root.session.getLastAssistantText() ?? "";
		expect(rejected).toBe(true);
		expect(instruction).toContain("any learning that could not be recorded and why");
		expect(handoff).toContain("Final report; review kept the change");
		expect(handoff).not.toContain("Agent failed");
		expect(handoff).not.toContain("did not finish");
	}, 30_000);

	it("keeps entries another settle handler proposed and continues within the same prompt", async () => {
		const proposeEntry = (pi: ExtensionAPI) => {
			pi.on("agent_before_settle", (event) => ({
				entries: [
					...event.entries,
					{ type: "custom_message", customType: "other-boundary", content: "Other boundary note.", display: false },
				],
			}));
		};
		const run = await fauxSession(
			[proposeEntry, registerCompletionReflection],
			[
				call("write", { path: "src/feature.ts", content: "export {};\n" }),
				fauxAssistantMessage("Preliminary."),
				fauxAssistantMessage("Final report."),
			],
			["write"],
		);
		try {
			await run.session.prompt("Implement.");
			const finalRequest = JSON.stringify(run.requests.at(-1)?.messages);
			expect(finalRequest).toContain("Other boundary note.");
			expect(finalRequest).toContain("Review your changes in `src/feature.ts`");
			expect(finalRequest.indexOf("Other boundary note.")).toBeLessThan(finalRequest.indexOf("Review your changes"));
			expect(run.session.getLastAssistantText()).toBe("Final report.");
		} finally {
			run.dispose();
		}
	}, 30_000);
});
