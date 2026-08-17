import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fuzzyFilter } from "@earendil-works/pi-tui";
import { containedProjectPath } from "./path-boundary.js";
import { parseTaskDocument } from "./task-document.js";
import { LEDGER_INDEX_PATH, taskLocation } from "./task-paths.js";

export class LedgerCatalogError extends Error {
	constructor(
		message: string,
		readonly code: string,
	) {
		super(message);
		this.name = "LedgerCatalogError";
	}
}

export interface CatalogWorkItemCounts {
	open: number;
	complete: number;
	cancelled: number;
	total: number;
}

export interface CatalogTask {
	taskId: string;
	taskPath: string;
	title: string;
	status: string;
	digest: string;
	acceptance: string[];
	workItems: CatalogWorkItemCounts;
	issues: number;
}

export function extractIndexedTaskPaths(indexContent: string): string[] {
	const matches = indexContent.match(/(?<![A-Za-z0-9._/-])\.ledger\/[A-Za-z0-9._/-]+\/task\.md/g) ?? [];
	return [...new Set(matches.map((path) => path.replace(/[),.;:]+$/, "")))].filter((path) => taskLocation(path));
}

export function catalogSearchText(task: CatalogTask): string {
	return [task.taskId, task.title, task.taskPath, task.status].join(" ");
}

export function filterCatalogTasks(tasks: CatalogTask[], query: string): CatalogTask[] {
	const trimmed = query.trim();
	if (!trimmed) return tasks;
	return fuzzyFilter(tasks, trimmed, catalogSearchText);
}

export function listLedgerTasks(ledgerRootInput: string): CatalogTask[] {
	const ledgerRoot = realpathSync(ledgerRootInput);
	const indexRel = containedProjectPath(ledgerRoot, LEDGER_INDEX_PATH);
	if (indexRel !== LEDGER_INDEX_PATH)
		throw new LedgerCatalogError("Ledger index must be .ledger/README.md", "invalid_index");
	const indexPath = resolve(ledgerRoot, LEDGER_INDEX_PATH);
	if (!existsSync(indexPath) || !lstatSync(indexPath).isFile() || lstatSync(indexPath).isSymbolicLink()) {
		throw new LedgerCatalogError("Ledger index is missing or not a regular file", "invalid_index");
	}
	const tasks: CatalogTask[] = [];
	for (const taskPath of extractIndexedTaskPaths(readFileSync(indexPath, "utf8"))) {
		try {
			tasks.push(inspectIndexedTask(ledgerRoot, taskPath));
		} catch (error) {
			if (error instanceof LedgerCatalogError && error.code === "unindexed_task") throw error;
			tasks.push(unreadableTask(taskPath));
		}
	}
	return tasks;
}

export function inspectLedgerTask(ledgerRootInput: string, taskPathInput: string): CatalogTask {
	const ledgerRoot = realpathSync(ledgerRootInput);
	const taskPath = containedProjectPath(ledgerRoot, taskPathInput);
	if (!taskPath || !taskLocation(taskPath)) {
		throw new LedgerCatalogError(`Unsafe or non-canonical task path: ${taskPathInput}`, "unsafe_path");
	}
	const indexRel = containedProjectPath(ledgerRoot, LEDGER_INDEX_PATH);
	if (indexRel !== LEDGER_INDEX_PATH)
		throw new LedgerCatalogError("Ledger index must be .ledger/README.md", "invalid_index");
	const indexed = extractIndexedTaskPaths(readFileSync(resolve(ledgerRoot, LEDGER_INDEX_PATH), "utf8"));
	if (!indexed.includes(taskPath))
		throw new LedgerCatalogError(`Ledger index does not list task: ${taskPath}`, "unindexed_task");
	return inspectIndexedTask(ledgerRoot, taskPath);
}

function inspectIndexedTask(ledgerRoot: string, taskPath: string): CatalogTask {
	const location = taskLocation(taskPath);
	if (!location) throw new LedgerCatalogError(`Invalid task path: ${taskPath}`, "unsafe_path");
	const relative = containedProjectPath(ledgerRoot, taskPath);
	if (relative !== taskPath)
		throw new LedgerCatalogError(`Unsafe or non-canonical task path: ${taskPath}`, "unsafe_path");
	const absolute = resolve(ledgerRoot, taskPath);
	if (!existsSync(absolute)) throw new LedgerCatalogError(`Task file is missing: ${taskPath}`, "missing_task");
	const stat = lstatSync(absolute);
	if (!stat.isFile() || stat.isSymbolicLink()) {
		throw new LedgerCatalogError(`Task must be a regular non-symlink file: ${taskPath}`, "unsafe_path");
	}
	const content = readFileSync(absolute, "utf8");
	const document = parseTaskDocument(content);
	return {
		taskId: location.taskId,
		taskPath,
		title: document.title ?? location.taskId,
		status: document.headers.status?.toLowerCase() ?? "unknown",
		digest: createHash("sha256").update(content).digest("hex"),
		acceptance: document.criteria.map((criterion) => criterion.id),
		workItems: {
			open: document.workItems.filter((item) => item.state === "open").length,
			complete: document.workItems.filter((item) => item.state === "complete").length,
			cancelled: document.workItems.filter((item) => item.state === "cancelled").length,
			total: document.workItems.length,
		},
		issues: document.workItemIssues.length,
	};
}

function unreadableTask(taskPath: string): CatalogTask {
	const location = taskLocation(taskPath);
	return {
		taskId: location?.taskId ?? taskPath,
		taskPath,
		title: location?.taskId ?? taskPath,
		status: "unreadable",
		digest: "",
		acceptance: [],
		workItems: { open: 0, complete: 0, cancelled: 0, total: 0 },
		issues: 1,
	};
}
