import type { Message } from "@earendil-works/pi-ai";
import { clip, textOf, thinkingOf } from "./content.js";
import { executionOperationsOf } from "./execution-trace.js";
import { extractPath, summarizeToolArgs } from "./tool-args.js";

export interface RenderedEntry {
	index?: number;
	entryId?: string;
	parentId?: string | null;
	timestamp?: string;
	sourceKind?: string;
	customType?: string;
	lineage?: "active" | "off-lineage";
	context?: Array<{ address: string; role: string; summary: string }>;
	role: string;
	summary: string;
	files?: string[];
}

const toolCalls = (content: Message["content"], full: boolean): string => {
	if (!content || typeof content === "string") return "";
	return content
		.filter((c) => c.type === "toolCall")
		.map((c) =>
			full
				? `[attempted ${c.name} call:${c.id}]\n${JSON.stringify(c.arguments, null, 2)}`
				: `${c.name}(${summarizeToolArgs(c.arguments)})`,
		)
		.join(", ");
};

const extractFilesFromContent = (content: Message["content"]): string[] => {
	if (!content || typeof content === "string") return [];
	return content
		.filter((c) => c.type === "toolCall")
		.map((c) => extractPath(c.arguments))
		.filter((p): p is string => p !== null);
};

export const renderMessage = (msg: Message, index: number, full = false): RenderedEntry => {
	if (msg.role === "user") {
		return { index, role: "user", summary: full ? textOf(msg.content) : clip(textOf(msg.content), 300) };
	}
	if (msg.role === "toolResult") {
		const prefix = msg.isError ? "ERROR " : "";
		const text = full ? textOf(msg.content) : clip(textOf(msg.content), 200);
		const nested =
			msg.toolName === "fabric_exec" || msg.toolName === "pi_exec" ? executionOperationsOf((msg as any).details) : [];
		const nestedSummary = (full ? nested : nested.slice(-20))
			.map((operation) =>
				full ? JSON.stringify(operation, null, 2) : `${operation.name}(${summarizeToolArgs(operation.args)})`,
			)
			.join("\n");
		const files = [
			...new Set(
				nested.map((operation) => extractPath(operation.args)).filter((path): path is string => path !== null),
			),
		].slice(0, 50);
		return {
			index,
			role: "tool_result",
			summary: `${prefix}[${msg.toolName}] ${text}${nestedSummary ? `\n${nestedSummary}` : ""}`,
			...(files.length > 0 && { files }),
		};
	}
	// bashExecution has command+output instead of content
	if ((msg as any).role === "bashExecution") {
		const cmd = (msg as any).command ?? "";
		const out = (msg as any).output ?? "";
		const text = full ? `$ ${cmd}\n${out}` : clip(`$ ${cmd}\n${out}`, 300);
		return { index, role: "bash", summary: text };
	}
	const text = full ? textOf(msg.content) : clip(textOf(msg.content), 300);
	const thinking = thinkingOf(msg.content);
	const thinkDisplay = thinking ? (full ? thinking : clip(thinking, 150)) : "";
	const tools = toolCalls(msg.content, full);
	const files = extractFilesFromContent(msg.content);
	const displayText = thinkDisplay ? `[thinking] ${thinkDisplay}\n${text}` : text;
	const summary = tools ? `${tools}\n${displayText}` : displayText;
	return { index, role: "assistant", summary, ...(files.length > 0 && { files }) };
};
