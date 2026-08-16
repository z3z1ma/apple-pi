import type { Message } from "@earendil-works/pi-ai";
import { contentBearingText } from "./content.js";
import type { RenderedEntry } from "./render-entries.js";
import { fileOperationsOf } from "./search-entries.js";

export interface DrillDownRequest {
	index: number;
	pathPattern: string;
	full: boolean;
	offset?: number;
	limit?: number;
}

const DRILL_DOWN = /^#(\d+):(.+?)(?::(full|\d+(?::\d+)?))?$/;

/** Parse #N:path, #N:path:full, #N:path:offset, or #N:path:offset:limit. */
export const parseDrillDown = (query: string): DrillDownRequest | undefined => {
	const match = DRILL_DOWN.exec(query.trim());
	if (!match) return undefined;
	const suffix = match[3];
	if (suffix === "full") {
		return { index: Number(match[1]), pathPattern: match[2]!, full: true };
	}
	if (suffix) {
		const [offset, limit] = suffix.split(":").map(Number);
		return {
			index: Number(match[1]),
			pathPattern: match[2]!,
			full: false,
			offset,
			...(limit !== undefined ? { limit } : {}),
		};
	}
	return { index: Number(match[1]), pathPattern: match[2]!, full: false };
};

const editBody = (args: Record<string, unknown>): string => {
	if (typeof args.content === "string") return args.content;
	if (Array.isArray(args.edits)) {
		return args.edits
			.map((edit, index) => {
				if (!edit || typeof edit !== "object") return `--- edit ${index + 1} ---`;
				const oldText = typeof (edit as any).oldText === "string" ? (edit as any).oldText : "";
				const newText = typeof (edit as any).newText === "string" ? (edit as any).newText : "";
				return `--- edit ${index + 1} ---\n${oldText}\n--- becomes ---\n${newText}`;
			})
			.join("\n\n");
	}
	return contentBearingText(args);
};

const bytePrefix = (value: string, bytes: number): string =>
	Buffer.from(value, "utf8").subarray(0, bytes).toString("utf8");

const formatContent = (path: string, toolName: string, body: string, request: DrillDownRequest): string => {
	const heading = `File: ${path}\nTool: ${toolName}`;
	const maxBytes = 50 * 1024;
	if (request.full) {
		const size = Buffer.byteLength(body, "utf8");
		if (size <= maxBytes) return `${heading}\n\n${body}`;
		return `${heading}\n\n${bytePrefix(body, maxBytes)}\n\n... (${size - maxBytes} bytes omitted; full recall is capped at 50KB)`;
	}

	const lines = body.split("\n");
	const offset = Math.max(0, request.offset ?? 0);
	const limit = Math.max(1, Math.min(2_000, request.limit ?? 30));
	const end = Math.min(lines.length, offset + limit);
	if (offset >= lines.length) {
		return `Offset ${offset} is beyond ${path}'s ${lines.length} lines.`;
	}
	const window = lines.slice(offset, end).join("\n");
	const range = request.offset === undefined ? "" : `\nLines ${offset + 1}-${end} (of ${lines.length})`;
	const continuation =
		end < lines.length
			? `\n\n--- Use #${request.index}:${path}:${end}:${limit} for the next ${limit} lines, or #${request.index}:${path}:full for complete content ---`
			: "";
	return `${heading}${range}\n\n${window}${continuation}`;
};

/** Expand file payloads from messages already filtered to the requested recall scope. */
export const expandEntryFile = (rendered: RenderedEntry[], messages: Message[], request: DrillDownRequest): string => {
	const offset = rendered.findIndex((entry) => entry.index === request.index);
	if (offset < 0) return `Entry #${request.index} is not available in the requested scope.`;
	const operations = fileOperationsOf(messages[offset]!);
	const matches =
		request.pathPattern === "file"
			? operations
			: operations.filter((operation) => operation.path.includes(request.pathPattern));
	if (matches.length === 0) {
		return `No file content found in entry #${request.index} for "${request.pathPattern}".`;
	}
	if (matches.length > 1) {
		const options = matches
			.map((operation) => `  #${request.index}:${operation.path} (${operation.toolName})`)
			.join("\n");
		return `Entry #${request.index} has ${matches.length} matching file operations:\n${options}\n\nUse a more specific #N:path.`;
	}
	const operation = matches[0]!;
	return formatContent(operation.path, operation.toolName, editBody(operation.args), request);
};
