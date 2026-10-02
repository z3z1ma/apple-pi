import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export interface FileChange {
	path: string;
	edits: number;
	added: number;
	removed: number;
	writes: number;
	writtenLines: number;
	created: boolean;
	failed: number;
}

interface ToolEvent {
	type?: unknown;
	toolCallId?: unknown;
	toolName?: unknown;
	args?: unknown;
	result?: unknown;
	isError?: unknown;
}

const TRACKED_TOOLS = new Set(["edit", "write"]);

function countLines(content: string): number {
	if (content.length === 0) return 0;
	return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

function countPatch(patch: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	let inHunks = false;
	for (const line of patch.split("\n")) {
		if (line.startsWith("@@")) inHunks = true;
		else if (inHunks && line.startsWith("+")) added++;
		else if (inHunks && line.startsWith("-")) removed++;
	}
	return { added, removed };
}

/** Attributes one agent's edit/write tool calls to files from its session events. */
export function createFileChangeTracker(cwd: string, displayRoot = cwd) {
	const files = new Map<string, FileChange & { existed: boolean }>();
	const pending = new Map<string, { file: FileChange & { existed: boolean }; content?: string }>();

	const displayPath = (absolute: string) => {
		const shown = relative(displayRoot, absolute);
		return shown && !shown.startsWith("..") && !isAbsolute(shown) ? shown : absolute;
	};

	return {
		observe(event: ToolEvent): void {
			if (typeof event.toolName !== "string" || !TRACKED_TOOLS.has(event.toolName)) return;
			if (typeof event.toolCallId !== "string") return;
			if (event.type === "tool_execution_start") {
				const args = (event.args ?? {}) as { path?: unknown; content?: unknown };
				if (typeof args.path !== "string" || args.path.length === 0) return;
				const absolute = resolve(cwd, args.path);
				let file = files.get(absolute);
				if (!file) {
					file = {
						path: displayPath(absolute),
						edits: 0,
						added: 0,
						removed: 0,
						writes: 0,
						writtenLines: 0,
						created: false,
						failed: 0,
						existed: existsSync(absolute),
					};
					files.set(absolute, file);
				}
				pending.set(event.toolCallId, {
					file,
					...(typeof args.content === "string" ? { content: args.content } : {}),
				});
				return;
			}
			if (event.type !== "tool_execution_end") return;
			const call = pending.get(event.toolCallId);
			if (!call) return;
			pending.delete(event.toolCallId);
			const { file } = call;
			if (event.isError) {
				file.failed++;
			} else if (event.toolName === "edit") {
				const patch = (event.result as { details?: { patch?: unknown } } | undefined)?.details?.patch;
				const delta = typeof patch === "string" ? countPatch(patch) : { added: 0, removed: 0 };
				file.edits++;
				file.added += delta.added;
				file.removed += delta.removed;
			} else {
				file.writes++;
				file.writtenLines = countLines(call.content ?? "");
				file.created = !file.existed;
			}
		},
		changes(): FileChange[] {
			return [...files.values()].map(({ existed: _existed, ...change }) => change);
		},
		reset(): void {
			files.clear();
			pending.clear();
		},
	};
}

export type FileChangeTracker = ReturnType<typeof createFileChangeTracker>;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function formatFileChanges(changes: readonly FileChange[]): string {
	if (changes.length === 0) return "";
	const lines = changes.map((change) => {
		const parts: string[] = [];
		if (change.writes > 0) {
			const calls = change.writes > 1 ? `${plural(change.writes, "call")}, ` : "";
			parts.push(`write ${plural(change.writtenLines, "line")} (${calls}${change.created ? "created" : "overwrote"})`);
		}
		if (change.edits > 0) parts.push(`edit +${change.added} -${change.removed} (${plural(change.edits, "call")})`);
		if (change.failed > 0) parts.push(plural(change.failed, "failed call"));
		return `- ${change.path}: ${parts.join("; ")}`;
	});
	return ["Files touched via edit/write:", ...lines].join("\n");
}
