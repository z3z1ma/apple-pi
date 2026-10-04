import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { formatToolArgs, stripAnsi, toPascalCase } from "./formatters.js";
import { setToolInspector } from "./patch.js";
import { TOOL_VIEWER_HEIGHT_PCT, type ToolInspection, ToolViewer } from "./tool-viewer.js";

function collectToolInspections(branch: readonly SessionEntry[]): ToolInspection[] {
	const calls = new Map<string, ToolInspection>();
	for (const entry of branch) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role === "assistant") {
			for (const block of message.content) {
				if (block.type !== "toolCall") continue;
				calls.set(block.id, {
					toolName: block.name,
					toolCallId: block.id,
					args: block.arguments,
					isPartial: true,
				});
			}
		} else if (message.role === "toolResult") {
			const call = calls.get(message.toolCallId);
			if (call) {
				call.result = { content: message.content, details: message.details, isError: message.isError };
				call.isPartial = false;
			}
		}
	}
	return [...calls.values()].reverse();
}

export function installToolInspector(pi: ExtensionAPI): void {
	let current: { done?: () => void } | undefined;
	let generation = 0;
	const close = () => {
		generation++;
		const previous = current;
		current = undefined;
		previous?.done?.();
	};
	const open = async (getInspection: () => ToolInspection, ctx: ExtensionContext) => {
		if (current || !ctx.hasUI || ctx.mode !== "tui") return;
		const interaction: { done?: () => void } = {};
		current = interaction;
		try {
			await ctx.ui.custom<undefined>(
				(tui, theme, keybindings, done) => {
					interaction.done = () => done(undefined);
					return new ToolViewer(tui, theme, keybindings, interaction.done, getInspection);
				},
				{ overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: `${TOOL_VIEWER_HEIGHT_PCT}%` } },
			);
		} finally {
			if (current === interaction) current = undefined;
		}
	};

	pi.on("session_start", (_event, ctx) => {
		close();
		setToolInspector(
			ctx.hasUI && ctx.mode === "tui"
				? (component) => {
						void open(() => component as unknown as ToolInspection, ctx).catch((error) => {
							ctx.ui.notify(
								`Could not open tool inspector: ${error instanceof Error ? error.message : error}`,
								"error",
							);
						});
					}
				: undefined,
		);
	});
	pi.on("session_tree", close);
	pi.on("session_shutdown", () => {
		close();
		setToolInspector();
	});

	pi.registerCommand("inspect-tool", {
		description: "Inspect a tool call's full inputs and retained output",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI || ctx.mode !== "tui" || current) return;
			const calls = collectToolInspections(ctx.sessionManager.getBranch());
			if (calls.length === 0) {
				ctx.ui.notify("No tool calls in this branch.", "info");
				return;
			}
			const labels = calls.map(
				(call, index) =>
					`${index + 1}. ${toPascalCase(call.toolName)}(${stripAnsi(formatToolArgs(call.toolName, call.args))})`,
			);
			const selectionGeneration = generation;
			const selected = await ctx.ui.select("Inspect tool · newest first", labels);
			if (selected === undefined || generation !== selectionGeneration) return;
			const call = calls[labels.indexOf(selected)];
			if (call) {
				await open(
					() =>
						collectToolInspections(ctx.sessionManager.getBranch()).find(
							(item) => item.toolCallId === call.toolCallId,
						) ?? call,
					ctx,
				);
			}
		},
	});
}
