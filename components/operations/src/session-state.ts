import { existsSync, lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { inspectLedgerTask, LedgerCatalogError } from "../../ledger/src/catalog.js";
import { containedProjectPath } from "../../ledger/src/path-boundary.js";
import { isLinkedCheckout } from "../../ledger/src/roots.js";
import { taskLocation } from "../../ledger/src/task-paths.js";

export const ACTIVE_TASK_ENTRY = "apple-pi.ledger.active-task";
export const ACTIVE_TASK_TOMBSTONE = "apple-pi.ledger.active-task.tombstone";
export const OPERATION_POINTER_ENTRY = "apple-pi.operations.pointer";
export const OPERATION_POINTER_TOMBSTONE = "apple-pi.operations.pointer.tombstone";

export type ActiveTaskStaleReason =
	| "missing"
	| "moved"
	| "unindexed"
	| "malformed"
	| "unrelated"
	| "not_regular_file"
	| "symlink";

export type OperationKind = "review" | "ralph";

export interface ActiveTaskPointer {
	schemaVersion: 1;
	ledgerRoot: string;
	taskPath: string;
}

export interface ActiveTaskTombstone {
	schemaVersion: 1;
	cleared: true;
}

export interface OperationPointer {
	schemaVersion: 1;
	kind: OperationKind;
	projectRoot: string;
	runId?: string;
}

export interface OperationPointerTombstone {
	schemaVersion: 1;
	kind: OperationKind;
	projectRoot: string;
	removed: true;
}

export interface SessionEntryLike {
	type?: string;
	customType?: string;
	data?: unknown;
}

export interface ActiveTaskProjection {
	pointer?: ActiveTaskPointer;
	stale?: ActiveTaskStaleReason;
}

export interface KnownOperationRoot {
	kind: OperationKind;
	projectRoot: string;
	runId?: string;
	stale?: ActiveTaskStaleReason;
}

export interface OperationsSessionProjection {
	activeTask: ActiveTaskProjection;
	operationRoots: KnownOperationRoot[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function customType(entry: SessionEntryLike): string | undefined {
	if (typeof entry.customType === "string") return entry.customType;
	if (entry.type === "custom" && typeof (entry as { customType?: unknown }).customType === "string") {
		return (entry as { customType: string }).customType;
	}
	return typeof entry.type === "string" && entry.type.startsWith("apple-pi.") ? entry.type : undefined;
}

function parseActivePointer(data: unknown): ActiveTaskPointer | undefined {
	if (!isRecord(data) || data.schemaVersion !== 1) return undefined;
	if (typeof data.ledgerRoot !== "string" || !data.ledgerRoot.trim()) return undefined;
	if (typeof data.taskPath !== "string" || !taskLocation(data.taskPath)) return undefined;
	return { schemaVersion: 1, ledgerRoot: data.ledgerRoot, taskPath: data.taskPath };
}

function parseActiveTombstone(data: unknown): ActiveTaskTombstone | undefined {
	if (!isRecord(data) || data.schemaVersion !== 1 || data.cleared !== true) return undefined;
	return { schemaVersion: 1, cleared: true };
}

function parseOperationPointer(data: unknown): OperationPointer | undefined {
	if (!isRecord(data) || data.schemaVersion !== 1) return undefined;
	if (data.kind !== "review" && data.kind !== "ralph") return undefined;
	if (typeof data.projectRoot !== "string" || !data.projectRoot.trim()) return undefined;
	if (data.runId !== undefined && (typeof data.runId !== "string" || !data.runId.trim())) return undefined;
	return {
		schemaVersion: 1,
		kind: data.kind,
		projectRoot: data.projectRoot,
		...(typeof data.runId === "string" && data.runId.trim() && { runId: data.runId.trim() }),
	};
}

function parseOperationTombstone(data: unknown): OperationPointerTombstone | undefined {
	if (!isRecord(data) || data.schemaVersion !== 1 || data.removed !== true) return undefined;
	if (data.kind !== "review" && data.kind !== "ralph") return undefined;
	if (typeof data.projectRoot !== "string" || !data.projectRoot.trim()) return undefined;
	return { schemaVersion: 1, kind: data.kind, projectRoot: data.projectRoot, removed: true };
}

export function foldActiveTaskPointer(entries: readonly SessionEntryLike[]): ActiveTaskPointer | undefined {
	let selected: ActiveTaskPointer | undefined;
	for (const entry of entries) {
		const type = customType(entry);
		if (type === ACTIVE_TASK_TOMBSTONE) {
			if (parseActiveTombstone(entry.data)) selected = undefined;
			continue;
		}
		if (type !== ACTIVE_TASK_ENTRY) continue;
		const pointer = parseActivePointer(entry.data);
		if (pointer) selected = pointer;
	}
	return selected;
}

export function foldOperationPointers(entries: readonly SessionEntryLike[]): OperationPointer[] {
	const byKey = new Map<string, OperationPointer>();
	for (const entry of entries) {
		const type = customType(entry);
		if (type === OPERATION_POINTER_TOMBSTONE) {
			const tombstone = parseOperationTombstone(entry.data);
			if (tombstone) byKey.delete(`${tombstone.kind}\0${tombstone.projectRoot}`);
			continue;
		}
		if (type !== OPERATION_POINTER_ENTRY) continue;
		const pointer = parseOperationPointer(entry.data);
		if (pointer) byKey.set(`${pointer.kind}\0${pointer.projectRoot}`, pointer);
	}
	return [...byKey.values()];
}

export function classifyActiveTaskStale(
	sessionRoot: string,
	pointer: ActiveTaskPointer,
): ActiveTaskStaleReason | undefined {
	let ledgerRoot: string;
	try {
		ledgerRoot = realpathSync(pointer.ledgerRoot);
	} catch {
		return "missing";
	}
	if (!isLinkedCheckout(sessionRoot, ledgerRoot)) return "unrelated";
	const relative = containedProjectPath(ledgerRoot, pointer.taskPath);
	if (!relative || !taskLocation(relative)) return "malformed";
	const absolute = resolve(ledgerRoot, relative);
	if (!existsSync(absolute)) return "moved";
	const stat = lstatSync(absolute);
	if (stat.isSymbolicLink()) return "symlink";
	if (!stat.isFile()) return "not_regular_file";
	try {
		inspectLedgerTask(ledgerRoot, relative);
	} catch (error) {
		if (error instanceof LedgerCatalogError && error.code === "unindexed_task") return "unindexed";
		if (error instanceof LedgerCatalogError && error.code === "missing_task") return "moved";
		if (error instanceof LedgerCatalogError && error.code === "unsafe_path") return "malformed";
		return "malformed";
	}
	return undefined;
}

export function classifyOperationRootStale(
	sessionRoot: string,
	projectRoot: string,
): ActiveTaskStaleReason | undefined {
	try {
		const resolved = realpathSync(projectRoot);
		if (!isLinkedCheckout(sessionRoot, resolved)) return "unrelated";
		return undefined;
	} catch {
		return "missing";
	}
}

export function projectOperationsSession(
	entries: readonly SessionEntryLike[],
	sessionRoot: string,
): OperationsSessionProjection {
	const pointer = foldActiveTaskPointer(entries);
	const stale = pointer ? classifyActiveTaskStale(sessionRoot, pointer) : undefined;
	const activeTask: ActiveTaskProjection = pointer ? { pointer, ...(stale && { stale }) } : {};
	const operationRoots = foldOperationPointers(entries).map((root) => {
		const stale = classifyOperationRootStale(sessionRoot, root.projectRoot);
		return { ...root, ...(stale && { stale }) };
	});
	return { activeTask, operationRoots };
}

export function knownProjectRoots(sessionRoot: string, projection: OperationsSessionProjection): string[] {
	const roots = new Set<string>();
	try {
		roots.add(realpathSync(sessionRoot));
	} catch {
		// Session root is validated by the caller before receipt reads.
	}
	for (const root of projection.operationRoots) {
		if (root.stale) continue;
		try {
			roots.add(realpathSync(root.projectRoot));
		} catch {
			// Stale classification already captured missing roots.
		}
	}
	return [...roots];
}
