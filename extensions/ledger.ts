import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { sendCommand } from "../components/session-state/src/client.js";
import { withWork } from "../components/session-state/src/work.js";
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
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!ctx.isProjectTrusted()) throw new Error("Changing a ledger task requires a trusted session repository");
			const root = realpathSync(ctx.cwd);
			const result = await transitionLedgerTask(root, params.task, params.status, linkableSession(ctx));
			const from = join(root, ".ledger", result.taskId);
			if (
				!isLiveStatus(result.status) &&
				withWork((db) => db.prepare("select 1 from work_tasks where bundle = ?").get(from))
			) {
				const receipt = await sendCommand(
					ctx.sessionManager.getSessionId(),
					{ kind: "task_moved", from, to: join(root, result.bundlePath) },
					{ signal },
				);
				if (receipt.stage === "failed")
					throw new Error(`The ledger task was archived, but its assignment path was not updated: ${receipt.reason}`);
			}
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
	// Only a session with a persisted transcript is written to history.json. Touching a file never assigns work.
	pi.on("tool_result", async (event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		const historySession = linkableSession(ctx);
		if (event.toolName === "write" || event.toolName === "edit") {
			if (!event.isError && typeof event.input.path === "string") {
				await linkChangedFile(ctx.cwd, event.input.path, historySession, ctx.signal);
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
			await linkSession(dirname(dirname(bundle)), basename(bundle), historySession, ctx.signal);
		}
	});
}
