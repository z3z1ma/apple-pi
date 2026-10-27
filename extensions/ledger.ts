import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { sendCommand } from "../components/session-state/src/client.js";
import type { Command } from "../components/session-state/src/protocol.js";
import { withWork } from "../components/session-state/src/work.js";
import { addLedgerTask, isLiveStatus, STATUSES, transitionLedgerTask } from "../components/shared/src/ledger-files.js";
import { LEDGER_SYSTEM_PROMPT, LEDGER_SYSTEM_PROMPT_TAG } from "../components/shared/src/ledger-system-prompt.js";
import { setSystemPromptSection } from "../components/shared/src/system-prompt-section.js";

export { addLedgerTask, transitionLedgerTask } from "../components/shared/src/ledger-files.js";
export const LEDGER_EXTENSION_PATH = fileURLToPath(import.meta.url);

/** Record task lifecycle and caller participation, unless session state is off or has never run here. */
async function recordInRuntime(
	ctx: ExtensionContext,
	command: Extract<Command, { kind: "task_opened" | "task_moved" }>,
	signal: AbortSignal | undefined,
	failure: string,
): Promise<void> {
	if (process.env.PI_SESSION_STATE_DISABLED === "1" || !withWork(() => true)) return;
	const receipt = await sendCommand(ctx.sessionManager.getSessionId(), command, { signal });
	if (receipt.stage === "failed") throw new Error(`${failure}: ${receipt.reason}`);
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
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!ctx.isProjectTrusted()) throw new Error("Adding a ledger task requires a trusted session repository");
			const result = await addLedgerTask(ctx.cwd, params.title, params.description, params.slug);
			await recordInRuntime(
				ctx,
				{ kind: "task_opened", bundle: join(realpathSync(ctx.cwd), result.bundlePath) },
				signal,
				"The ledger task was added, but the runtime did not record it as an obligation",
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
			const result = await transitionLedgerTask(root, params.task, params.status);
			const from = join(root, ".ledger", result.taskId);
			if (result.status === "done" || result.status === "cancelled")
				await recordInRuntime(
					ctx,
					{ kind: "task_moved", from, to: join(root, result.bundlePath), status: result.status },
					signal,
					"The ledger task was archived, but the runtime did not record its close",
				);
			else
				await recordInRuntime(
					ctx,
					{ kind: "task_opened", bundle: join(root, result.bundlePath) },
					signal,
					"The ledger status changed, but the runtime did not record participation",
				);
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
}
