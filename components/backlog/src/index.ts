import {
	defineTool,
	type ExtensionAPI,
	type ExtensionCommandContext,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	addBacklogItem,
	BACKLOG_STATE_ENTRY,
	type BacklogItem,
	type BacklogState,
	createBacklogState,
	deleteBacklogItem,
	editBacklogItem,
	moveBacklogItem,
	restoreBacklogState,
} from "./state.js";
import { type BacklogManagerAction, BacklogManagerComponent } from "./ui/backlog-manager.js";

interface BacklogMutationDetails {
	item: BacklogItem;
	count: number;
}

interface BacklogStatusUi {
	setStatus(key: string, text: string | undefined): void;
}

function publishBacklogCount(ui: BacklogStatusUi, count: number): void {
	ui.setStatus("backlog", count > 0 ? `backlog ${count}` : undefined);
}

function snapshot(state: BacklogState): BacklogState {
	return { items: state.items.map((item) => ({ ...item })), nextId: state.nextId };
}

function formatBacklog(items: readonly BacklogItem[]): string {
	if (items.length === 0) return "The session backlog is empty.";
	return items
		.map((item, index) => {
			const description = item.description ? `\n${item.description}` : "";
			return `${index + 1}. #${item.id} ${item.title}${description}`;
		})
		.join("\n\n");
}

async function openBacklogManager(
	ctx: ExtensionCommandContext,
	getState: () => BacklogState,
	setState: (state: BacklogState) => void,
	persist: () => void,
): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("/backlog requires interactive mode", "error");
		return;
	}

	let selectedId: number | undefined;
	for (;;) {
		const state = getState();
		const action = await ctx.ui.custom<BacklogManagerAction>(
			(tui, theme, _keybindings, done) => new BacklogManagerComponent(tui, theme, state.items, selectedId, done),
		);
		if (!action || action.type === "close") return;

		if (action.type === "create") {
			const title = await ctx.ui.editor("Backlog title", "");
			if (title === undefined) continue;
			const description = await ctx.ui.editor("Backlog description", "");
			if (description === undefined) continue;
			try {
				const added = addBacklogItem(getState(), { title, description });
				setState(added.state);
				selectedId = added.item.id;
				persist();
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
			continue;
		}

		selectedId = action.id;
		if (action.type === "move") {
			setState(moveBacklogItem(getState(), action.id, action.direction));
			persist();
			continue;
		}

		const item = getState().items.find((candidate) => candidate.id === action.id);
		if (!item) continue;
		if (action.type === "delete") {
			const confirmed = await ctx.ui.confirm("Delete backlog item?", `#${item.id} ${item.title}`);
			if (confirmed) {
				setState(deleteBacklogItem(getState(), item.id));
				persist();
			}
			continue;
		}

		const title = await ctx.ui.editor("Backlog title", item.title);
		if (title === undefined) continue;
		const description = await ctx.ui.editor("Backlog description", item.description);
		if (description === undefined) continue;
		try {
			setState(editBacklogItem(getState(), item.id, { title, description }));
			persist();
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		}
	}
}

export function installBacklog(pi: ExtensionAPI): void {
	let state = createBacklogState();
	const persist = (ui?: BacklogStatusUi) => {
		pi.appendEntry(BACKLOG_STATE_ENTRY, snapshot(state));
		if (ui) publishBacklogCount(ui, state.items.length);
	};
	const restore = (ctx: { sessionManager: { getBranch(): readonly unknown[] }; ui: BacklogStatusUi }) => {
		state = restoreBacklogState(ctx.sessionManager.getBranch());
		publishBacklogCount(ctx.ui, state.items.length);
	};

	pi.on("session_start", (_event, ctx) => restore(ctx));
	pi.on("session_tree", (_event, ctx) => restore(ctx));

	pi.registerTool(
		defineTool({
			name: "backlog_add",
			label: "Backlog Add",
			description:
				"Park one concrete item in the current session's branch-aware backlog. This records worthwhile work that is outside the active scope; it does not start the work or create a Ledger task.",
			promptSnippet: "Park a concrete out-of-scope item in the session backlog",
			promptGuidelines: [
				"Use backlog_add when current work reveals a concrete worthwhile item that should be preserved but not pursued now.",
				"Do not use backlog_add for active implementation steps, vague possibilities, or work already represented by a Ledger task.",
				"Treat backlog_add as parking an item, not as a commitment to execute it or promote it to Ledger.",
			],
			parameters: Type.Object({
				title: Type.String({
					minLength: 1,
					maxLength: 160,
					description: "Concise one-line title for the parked item.",
				}),
				description: Type.Optional(
					Type.String({
						maxLength: 2_000,
						description: "Optional context explaining why the item matters or what was noticed.",
					}),
				),
			}),
			executionMode: "sequential",
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const added = addBacklogItem(state, params);
				state = added.state;
				persist(ctx.ui);
				return {
					content: [{ type: "text" as const, text: `Backlogged #${added.item.id}: ${added.item.title}` }],
					details: { item: added.item, count: state.items.length } satisfies BacklogMutationDetails,
				};
			},
			renderCall(args, theme) {
				return new Text(`${theme.fg("toolTitle", theme.bold("Backlog Add "))}${theme.fg("accent", args.title)}`, 0, 0);
			},
			renderResult(result, _options, theme) {
				const details = result.details as BacklogMutationDetails | undefined;
				if (!details) return new Text(theme.fg("error", "Backlog item was not recorded"), 0, 0);
				return new Text(
					`${theme.fg("success", "✓ Parked ")}${theme.fg("accent", `#${details.item.id}`)} ${theme.fg("muted", details.item.title)}`,
					0,
					0,
				);
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "backlog_list",
			label: "Backlog List",
			description:
				"Read the ordered backlog for the current session branch. Use the stable numeric IDs with backlog_take when an item moves into active work or is recorded as a Ledger task; editing and ordering remain human-owned through /backlog.",
			promptSnippet: "Read the current session backlog when the user refers to parked items",
			promptGuidelines: [
				"Use backlog_list when the user asks about, selects, or wants to act on items already parked in the session backlog.",
			],
			parameters: Type.Object({}),
			async execute() {
				const formatted = formatBacklog(state.items);
				const output = truncateHead(formatted, { maxBytes: 50 * 1024, maxLines: 2_000 });
				return {
					content: [
						{
							type: "text" as const,
							text: output.truncated
								? `${output.content}\n\n[Backlog output truncated; ${state.items.length} items total.]`
								: output.content,
						},
					],
					details: { count: state.items.length },
				};
			},
			renderCall(_args, theme) {
				return new Text(theme.fg("toolTitle", theme.bold("Backlog List")), 0, 0);
			},
			renderResult(result, _options, theme) {
				const count = (result.details as { count?: number } | undefined)?.count ?? 0;
				return new Text(
					theme.fg("muted", count === 0 ? "No parked items" : `${count} parked item${count === 1 ? "" : "s"}`),
					0,
					0,
				);
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "backlog_take",
			label: "Backlog Take",
			description:
				"Remove one item from the current session backlog because it is now being handled in the active work or has been recorded as a durable Ledger task. This does not itself complete the work or create a Ledger task.",
			promptSnippet: "Take an item out of the session backlog when active work or a Ledger task assumes ownership",
			promptGuidelines: [
				"Use backlog_take when you begin handling a listed item in the active work, or after the user and agent agree to promote it and it has been successfully recorded as a Ledger task.",
				"Do not remove an item merely because it was discussed, and do not treat removal as evidence that the underlying work is complete.",
				"Use backlog_list first when the item's stable numeric ID is not already known.",
			],
			parameters: Type.Object({
				id: Type.Integer({
					minimum: 1,
					description: "Stable numeric ID of the backlog item to remove.",
				}),
			}),
			executionMode: "sequential",
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const item = state.items.find((candidate) => candidate.id === params.id);
				if (!item) throw new Error(`Backlog item #${params.id} not found`);
				state = deleteBacklogItem(state, item.id);
				persist(ctx.ui);
				return {
					content: [{ type: "text" as const, text: `Removed #${item.id} from the backlog: ${item.title}` }],
					details: { item, count: state.items.length } satisfies BacklogMutationDetails,
				};
			},
			renderCall(args, theme) {
				return new Text(
					`${theme.fg("toolTitle", theme.bold("Backlog Take "))}${theme.fg("accent", `#${args.id}`)}`,
					0,
					0,
				);
			},
			renderResult(result, _options, theme) {
				const details = result.details as BacklogMutationDetails | undefined;
				if (!details) return new Text(theme.fg("error", "Backlog item was not removed"), 0, 0);
				return new Text(
					`${theme.fg("success", "✓ Took ")}${theme.fg("accent", `#${details.item.id}`)} ${theme.fg("muted", details.item.title)}`,
					0,
					0,
				);
			},
		}),
	);

	pi.registerCommand("backlog", {
		description: "Create, browse, edit, delete, and manually reorder the session backlog",
		handler: async (_args, ctx) =>
			openBacklogManager(
				ctx,
				() => state,
				(next) => {
					state = next;
				},
				() => persist(ctx.ui),
			),
	});
}

export default installBacklog;
export * from "./state.js";
