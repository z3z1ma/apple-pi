import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { LEDGER_LINK_CHANNEL, type LedgerLink } from "../components/shared/src/ledger-events.js";
import {
	addLedgerTask,
	isLiveStatus,
	linkChangedFile,
	linkSession,
	observeBundles,
	STATUSES,
	transitionLedgerTask,
} from "../components/shared/src/ledger-files.js";
import { LEDGER_SYSTEM_PROMPT, LEDGER_SYSTEM_PROMPT_TAG } from "../components/shared/src/ledger-system-prompt.js";
import { setSystemPromptSection } from "../components/shared/src/system-prompt-section.js";

export { addLedgerTask, transitionLedgerTask } from "../components/shared/src/ledger-files.js";
export const LEDGER_EXTENSION_PATH = fileURLToPath(import.meta.url);
const OPAQUE_CHANGE_TOOLS = new Set(["bash", "pi_exec"]);

/** Only sessions with a persisted transcript link; an ID without a session file would point at nothing. */
function linkableSession(ctx: ExtensionContext): string | undefined {
	return ctx.sessionManager.getSessionFile() ? ctx.sessionManager.getSessionId() : undefined;
}

function createLedgerAddTool() {
	return defineTool({
		name: "ledger_add",
		label: "Add to ledger",
		description:
			"Create one new timestamped .ledger task bundle with task.md, retrospective.md, and a live index row. Add plans, specifications, notes, decisions, evidence, or assets later only when useful. Not for listing, inspecting, selecting, updating, closing, or executing existing tasks.",
		promptSnippet: "Add a new .ledger task bundle when the user asks to create one",
		parameters: Type.Object({
			title: Type.String({ description: "One-line task title, 1-160 characters." }),
			description: Type.String({
				description:
					"One-line search summary, 1-400 characters. Stored on the live index row and carried into history.",
			}),
			slug: Type.Optional(
				Type.String({ description: "Optional lowercase kebab slug. Defaults to a slug derived from the title." }),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.isProjectTrusted()) throw new Error("Adding a ledger task requires a trusted session repository");
			const result = await addLedgerTask(
				ctx.cwd,
				params.title,
				params.description,
				params.slug,
				new Date(),
				linkableSession(ctx),
			);
			return {
				content: [{ type: "text" as const, text: `Added ${result.taskPath}` }],
				details: result,
			};
		},
		renderCall(args, theme) {
			return new Text(`${theme.fg("toolTitle", theme.bold("Add to ledger "))}${theme.fg("accent", args.title)}`, 0, 0);
		},
		renderResult(result, _options, theme) {
			const content = result.content[0]?.type === "text" ? result.content[0].text : "No output";
			return new Text(theme.fg("dim", content), 0, 0);
		},
	});
}

function createLedgerStatusTool() {
	return defineTool({
		name: "ledger_status",
		label: "Set ledger task status",
		description:
			"Move one live .ledger task to a new status. planning, ready, and in-progress update Status in task.md and on the live index row. done and cancelled archive the bundle into .ledger/history and move the row to the history index; call them only after edits to the bundle are committed. Not for creating, inspecting, shaping, executing, or judging completeness.",
		promptSnippet: "Move a ledger task between planning, ready, in-progress, done, and cancelled",
		parameters: Type.Object({
			task: Type.String({
				description: "Task id, .ledger/<id>, or .ledger/<id>/task.md of the live task.",
			}),
			status: Type.Union(
				STATUSES.map((status) => Type.Literal(status)),
				{ description: "New status. done and cancelled archive the task." },
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.isProjectTrusted()) throw new Error("Changing a ledger task requires a trusted session repository");
			const result = await transitionLedgerTask(ctx.cwd, params.task, params.status, linkableSession(ctx));
			const verb = isLiveStatus(result.status) ? "Moved" : "Archived";
			return {
				content: [{ type: "text" as const, text: `${verb} ${result.taskPath} to ${result.status}` }],
				details: result,
			};
		},
		renderCall(args, theme) {
			return new Text(
				`${theme.fg("toolTitle", theme.bold("Set ledger status "))}${theme.fg("accent", `${args.status} ${args.task}`)}`,
				0,
				0,
			);
		},
		renderResult(result, _options, theme) {
			const content = result.content[0]?.type === "text" ? result.content[0].text : "No output";
			return new Text(theme.fg("dim", content), 0, 0);
		},
	});
}

export default function installLedger(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (event) =>
		setSystemPromptSection(event.systemPromptOptions, LEDGER_SYSTEM_PROMPT_TAG, LEDGER_SYSTEM_PROMPT),
	);
	pi.registerTool(createLedgerAddTool());
	pi.registerTool(createLedgerStatusTool());
	// Bundle signatures seen before each bash or pi_exec call, per session; their changes are found by comparison.
	const observed = new Map<string, Map<string, string>>();
	pi.on("tool_call", (event, ctx) => {
		if (OPAQUE_CHANGE_TOOLS.has(event.toolName))
			observed.set(ctx.sessionManager.getSessionId(), observeBundles(ctx.cwd));
	});
	const announce = (sessionId: string, bundle: string | undefined, via: LedgerLink["via"]) => {
		if (bundle)
			pi.events.emit(LEDGER_LINK_CHANNEL, { sessionId, bundle, taskId: basename(bundle), via } satisfies LedgerLink);
	};
	// No trust gate: the session already changed the bundle, and workers may run untrusted. Every session announces
	// its touches; only one with a transcript file is written to history.json, whose ids must point at a transcript.
	pi.on("tool_result", async (event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		const historySession = linkableSession(ctx);
		if ((event.toolName === "ledger_add" || event.toolName === "ledger_status") && !event.isError) {
			const details = event.details as { bundlePath?: string } | undefined;
			if (details?.bundlePath) announce(sessionId, resolve(ctx.cwd, details.bundlePath), event.toolName);
			return;
		}
		if (event.toolName === "write" || event.toolName === "edit") {
			if (!event.isError && typeof event.input.path === "string") {
				announce(sessionId, await linkChangedFile(ctx.cwd, event.input.path, historySession, ctx.signal), "edit");
			}
			return;
		}
		const before = OPAQUE_CHANGE_TOOLS.has(event.toolName) ? observed.get(sessionId) : undefined;
		if (!before) return;
		const after = observeBundles(ctx.cwd);
		observed.set(sessionId, after);
		for (const [bundle, signature] of after) {
			const previous = before.get(bundle);
			if (previous === undefined || previous === signature) continue;
			announce(
				sessionId,
				await linkSession(dirname(dirname(bundle)), basename(bundle), historySession, ctx.signal),
				"edit",
			);
		}
	});
}
