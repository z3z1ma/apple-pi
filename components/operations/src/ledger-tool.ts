import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { type CatalogTask, filterCatalogTasks, inspectLedgerTask, listLedgerTasks } from "../../ralph/src/catalog.js";
import { resolveRalphRoots } from "../../ralph/src/roots.js";
import { mutateTaskWorkItems, type WorkItemMutation } from "../../ralph/src/task.js";
import { parseTaskDocument } from "../../ralph/src/task-document.js";
import { taskLocation } from "../../ralph/src/task-paths.js";
import { ACTIVE_TASK_ENTRY, ACTIVE_TASK_TOMBSTONE, type ActiveTaskPointer } from "./session-state.js";

function textResult(text: string, isError = false, details?: unknown) {
	return { content: [{ type: "text" as const, text }], isError, details };
}

function required(value: unknown, name: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
	return value.trim();
}

function mutationFrom(params: Record<string, unknown>): WorkItemMutation {
	const kind = required(params.mutation, "mutation");
	const id = required(params.work_item_id, "work_item_id");
	if (kind === "add") return { kind, id, description: required(params.description, "description") };
	if (kind === "reorder")
		return {
			kind,
			id,
			...(typeof params.before_id === "string" && params.before_id.trim() && { beforeId: params.before_id.trim() }),
		};
	if (kind === "complete" || kind === "reopen") return { kind, id };
	if (kind === "cancel") return { kind, id, reason: required(params.reason, "reason") };
	throw new Error(`Unknown work-item mutation: ${kind}`);
}

function compactTask(task: CatalogTask): string {
	return `${task.taskPath}  ${task.status}  ${task.title}  WI ${task.workItems.complete}/${task.workItems.total} open ${task.workItems.open}`;
}

export function createLedgerTool(options: {
	appendEntry: (type: string, data: unknown) => void;
	resolveLedgerRoot: (cwd: string, root?: string) => string;
}) {
	return defineTool({
		name: "ledger",
		label: "Ledger",
		description:
			"List, inspect, select, or clear the session's active ledger task, and mutate WI-### work items through the canonical Ralph parser. Does not close tasks or start Ralph.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("list"),
				Type.Literal("inspect"),
				Type.Literal("select"),
				Type.Literal("clear"),
				Type.Literal("mutate_work_items"),
			]),
			task: Type.Optional(Type.String({ description: "Canonical .ledger/<id>/task.md path." })),
			query: Type.Optional(Type.String({ description: "Fuzzy filter over task id, title, and path." })),
			ledger_root: Type.Optional(
				Type.String({ description: "Linked checkout containing .ledger. Defaults to the session worktree." }),
			),
			offset: Type.Optional(Type.Number({ description: "List pagination offset." })),
			limit: Type.Optional(Type.Number({ description: "List page size, max 50." })),
			digest: Type.Optional(Type.String({ description: "Expected task digest for compare-and-swap mutation." })),
			mutation: Type.Optional(
				Type.Union([
					Type.Literal("add"),
					Type.Literal("reorder"),
					Type.Literal("complete"),
					Type.Literal("reopen"),
					Type.Literal("cancel"),
				]),
			),
			work_item_id: Type.Optional(Type.String()),
			description: Type.Optional(Type.String()),
			before_id: Type.Optional(Type.String()),
			reason: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				if (!ctx.isProjectTrusted()) throw new Error("Ledger actions require a trusted session repository");
				const ledgerRoot = options.resolveLedgerRoot(ctx.cwd, params.ledger_root);
				if (params.action === "clear") {
					options.appendEntry(ACTIVE_TASK_TOMBSTONE, { schemaVersion: 1, cleared: true } satisfies {
						schemaVersion: 1;
						cleared: true;
					});
					return textResult("Cleared the active ledger task for this session branch.");
				}
				if (params.action === "list") {
					const query = typeof params.query === "string" ? params.query : "";
					const all = filterCatalogTasks(listLedgerTasks(ledgerRoot), query);
					const offset = Math.max(0, Math.floor(params.offset ?? 0));
					const limit = Math.min(50, Math.max(1, Math.floor(params.limit ?? 20)));
					const page = all.slice(offset, offset + limit);
					return textResult(page.length ? page.map(compactTask).join("\n") : "No indexed ledger tasks.", false, {
						ledgerRoot,
						total: all.length,
						offset,
						limit,
						tasks: page,
					});
				}
				const taskPath = required(params.task, "task");
				if (!taskLocation(taskPath)) throw new Error(`Invalid task path: ${taskPath}`);
				const inspected = inspectLedgerTask(ledgerRoot, taskPath);
				if (params.action === "inspect") {
					return textResult(compactTask(inspected), false, inspected);
				}
				if (params.action === "select") {
					const pointer: ActiveTaskPointer = {
						schemaVersion: 1,
						ledgerRoot: realpathSync(ledgerRoot),
						taskPath: inspected.taskPath,
					};
					options.appendEntry(ACTIVE_TASK_ENTRY, pointer);
					return textResult(`Selected ${inspected.taskPath}`, false, pointer);
				}
				const digest = required(params.digest, "digest");
				const before = parseTaskDocument(readFileSync(resolve(ledgerRoot, inspected.taskPath), "utf8"));
				const result = await mutateTaskWorkItems(resolve(ledgerRoot, inspected.taskPath), digest, mutationFrom(params));
				const after = parseTaskDocument(result.content);
				return textResult(`Mutated ${inspected.taskPath}: digest ${result.digest.slice(0, 12)}`, false, {
					taskPath: inspected.taskPath,
					beforeDigest: digest,
					afterDigest: result.digest,
					before: before.workItems,
					after: after.workItems,
				});
			} catch (error) {
				return textResult(error instanceof Error ? error.message : String(error), true);
			}
		},
		renderCall(args, theme) {
			return new Text(
				`${theme.fg("toolTitle", theme.bold("Ledger "))}${theme.fg("accent", args.action)} ${theme.fg("dim", args.task ?? args.query ?? "")}`,
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

export function resolveLedgerRoot(cwd: string, ledgerRoot?: string): string {
	return resolveRalphRoots(cwd, undefined, ledgerRoot).ledgerRoot;
}
