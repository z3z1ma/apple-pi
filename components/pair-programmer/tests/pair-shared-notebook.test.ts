import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { type AgentSession, defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { fauxModelBackend } from "../../../tests/helpers/faux-model.js";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { getChildPairNotebook, getSharedNotebook, offerChildPairNotebook } from "../../notebook/src/shared-notebook.js";
import installPair from "../src/extension.js";
import { createPairSession } from "../src/session.js";
import { disposeAgentSession } from "../../subagents/src/session-lifecycle.js";

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "apple-pi-pair-shared-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
// The primary pair stays off; this suite drives a coding child's pair session directly.
writeFileSync(join(agentDir, ".pair-state.json"), JSON.stringify({ enabled: false }));

const sessions: Array<{ dispose(): void }> = [];
const providers: Array<{ unregister(): void }> = [];
afterEach(() => {
	for (const session of sessions.splice(0)) session.dispose();
	for (const provider of providers.splice(0)) provider.unregister();
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
		: "";
}

/** Pair tools unrelated to the notebook; the allowlist requires each name to be present. */
function inertTool(name: string) {
	return defineTool({
		name,
		label: name,
		description: `${name} fixture`,
		parameters: Type.Object({}),
		async execute() {
			return { content: [{ type: "text", text: "ok" }], details: {} };
		},
	});
}

async function primaryWithPairedCoder() {
	let hostPi!: ExtensionAPI;
	const captureHost = (pi: ExtensionAPI) => {
		hostPi = pi;
	};
	const primaryScript = [
		fauxAssistantMessage("Navigation anchor ready."),
		fauxAssistantMessage([fauxToolCall("update_notebook", { reflections: [{ content: "Staging moved to 7443." }] })], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage("Recorded."),
	];
	const primary = await fauxSession([installPair, captureHost], primaryScript, ["update_notebook"]);
	sessions.push(primary);
	await primary.session.prompt("Establish a branch point.");
	await primary.session.prompt("PRIMARY_SOURCE_MARKER staging moved to 7443.");
	const notebook = getSharedNotebook(hostPi.events)!;
	let childPi!: ExtensionAPI;
	let child!: Awaited<ReturnType<typeof fauxSession>>;
	child = await fauxSession(
		[
			(pi) => {
				childPi = pi;
				offerChildPairNotebook(pi, notebook, { agentType: "fixture-coder", agentId: "child-1" }, () => {
					return child.session.sessionManager;
				});
			},
		],
		[
			fauxAssistantMessage([fauxToolCall("bash", { command: "printf 'CHILD_ONLY_RESULT\\n'" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Probe done."),
		],
		["bash"],
	);
	sessions.push(child);
	await child.session.prompt("Probe the staging endpoint.");
	const childSources = child.session.sessionManager
		.getBranch()
		.filter((entry) => entry.type === "message" && entry.message.role !== "user")
		.map((entry) => entry.id)
		.slice(0, 2);
	return { primary, child, childPi, childSources, captureHost };
}

async function childPair(childPi: ExtensionAPI, child: AgentSession, script: Array<(context: Context) => unknown>) {
	const faux = registerFauxProvider({ provider: "faux-pair", models: [{ id: "faux-pair", contextWindow: 100_000 }] });
	providers.push(faux);
	faux.setResponses(script as never);
	const model = faux.getModel();
	const pair = await createPairSession({
		cwd: child.sessionManager.getCwd(),
		model,
		systemPrompt: "Pair fixture.",
		adviseTool: inertTool("share_note"),
		escalateTool: inertTool("ask_consultant"),
		receiptTool: inertTool("expand_receipt"),
		attentionTool: inertTool("set_pair_attention"),
		sharedNotebook: getChildPairNotebook(childPi.events),
		seedSource: { entries: () => [], rollingAdvice: () => [] },
		primarySessionManager: child.sessionManager,
		modelRuntime: fauxModelBackend(model).modelRuntime,
	});
	sessions.push(pair);
	return pair;
}

describe("a coding child's pair session over the primary notebook", () => {
	it.each(["primary tree navigation", "primary shutdown", "child disposal"])(
		"rejects a fresh, non-aborted pair addition after %s",
		async (operation) => {
			const { primary, child, childPi, childSources, captureHost } = await primaryWithPairedCoder();
			const add = (content: string) => () =>
				fauxAssistantMessage(
					[fauxToolCall("update_notebook", { reflections: [{ content, sourceEntryIds: childSources }] })],
					{
						stopReason: "toolUse",
					},
				);
			const pair = await childPair(childPi, child.session, [
				add("The probe needs printf on this host; reuse it."),
				() => fauxAssistantMessage("Nothing to add."),
				add("STALE_PAIR_WRITE must not reach any primary."),
				() => fauxAssistantMessage("Capture rejected."),
			]);
			await pair.prompt("Review the first span.");
			expect(textOf(pair.messages.findLast((message) => message.role === "toolResult"))).toContain("Notebook updated");
			let current = primary;
			if (operation === "primary tree navigation") {
				await primary.session.navigateTree(primary.session.getUserMessagesForForking()[0].entryId, {
					summarize: false,
				});
			} else if (operation === "primary shutdown") {
				await primary.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
				current = await fauxSession([installPair, captureHost], [fauxAssistantMessage("Fresh owner.")], []);
				sessions.push(current);
				await current.session.prompt("Establish a fresh active owner.");
			} else {
				await disposeAgentSession(child.session);
			}
			const previousArchive = structuredClone(primary.session.sessionManager.getEntries());
			const currentArchive = structuredClone(current.session.sessionManager.getEntries());
			await pair.prompt("Review a later span.");
			const late = pair.messages.findLast((message) => message.role === "toolResult");
			expect(late?.role === "toolResult" && late.isError).toBe(true);
			expect(pair.getLastAssistantText()).toBe("Capture rejected.");
			expect(primary.session.sessionManager.getEntries()).toEqual(previousArchive);
			expect(current.session.sessionManager.getEntries()).toEqual(currentArchive);
		},
		30_000,
	);
});
