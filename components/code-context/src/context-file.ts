import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export const CONTEXT_DIRECTORY = ".context";
export const CONTEXT_FILE_EXTENSION = ".md";

const DELIVERING_TOOLS = new Set(["read", "edit", "write"]);

type ContextFileStatus = "no_context_file" | "live" | "missing" | "malformed";

export interface ResolvedContext {
	status: ContextFileStatus;
	isContextFile: boolean;
	sourcePath: string;
	contextFilePath: string;
	displayPath: string;
	contextFileDisplayPath: string;
	content?: string;
	marker?: string;
	diagnostic?: string;
}

export function projectRoot(cwd: string): string {
	for (let current = cwd; ; current = dirname(current)) {
		if (existsSync(join(current, ".git"))) return current;
		if (dirname(current) === current) return cwd;
	}
}

function inside(root: string, path: string): string | undefined {
	const local = relative(root, path);
	return local && !local.startsWith("..") && !isAbsolute(local) ? local : undefined;
}

function displayPath(path: string, cwd: string): string {
	return inside(cwd, path)?.split(sep).join("/") ?? path;
}

function contextFilePair(path: string, root: string): { sourcePath: string; contextFilePath: string } | undefined {
	const local = inside(root, path);
	if (!local) return undefined;
	const [top, ...rest] = local.split(sep);
	if (top !== CONTEXT_DIRECTORY)
		return { sourcePath: path, contextFilePath: join(root, CONTEXT_DIRECTORY, `${local}${CONTEXT_FILE_EXTENSION}`) };
	const mirrored = rest.join(sep);
	if (!mirrored.endsWith(CONTEXT_FILE_EXTENSION) || mirrored.length === CONTEXT_FILE_EXTENSION.length) return undefined;
	return { sourcePath: join(root, mirrored.slice(0, -CONTEXT_FILE_EXTENSION.length)), contextFilePath: path };
}

function contextRef(displayPath: string, content: string): string {
	const hash = createHash("sha256").update(content).digest("hex");
	return `<context-ref path="${displayPath}" hash="sha256:${hash}" />`;
}

function isMarkerLive(marker: string, messages: readonly AgentMessage[]): boolean {
	return messages.some(
		(message) =>
			message.role === "toolResult" &&
			DELIVERING_TOOLS.has(message.toolName) &&
			message.content.some((block) => block.type === "text" && block.text.includes(marker)),
	);
}

function loadContextFile(contextFilePath: string): { content?: string; diagnostic?: string } | undefined {
	let bytes: Buffer;
	try {
		bytes = readFileSync(contextFilePath);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return undefined;
		return { diagnostic: error instanceof Error ? error.message : String(error) };
	}
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return { diagnostic: "it is not valid UTF-8" };
	}
	const content = text.replace(/\r\n/g, "\n").trimEnd();
	return content ? { content } : { diagnostic: "it is empty" };
}

export function resolveContext(
	path: string,
	cwd: string,
	messages: readonly AgentMessage[],
): ResolvedContext | undefined {
	const pair = contextFilePair(path, projectRoot(cwd));
	if (!pair) return undefined;
	const shown = displayPath(pair.sourcePath, cwd);
	const base = {
		...pair,
		isContextFile: pair.contextFilePath === path,
		displayPath: shown,
		contextFileDisplayPath: displayPath(pair.contextFilePath, cwd),
	};
	const loaded = loadContextFile(pair.contextFilePath);
	if (!loaded) return { ...base, status: "no_context_file" };
	if (loaded.content === undefined) return { ...base, status: "malformed", diagnostic: loaded.diagnostic };
	const marker = contextRef(shown, loaded.content);
	return { ...base, status: isMarkerLive(marker, messages) ? "live" : "missing", content: loaded.content, marker };
}

export function contextBlock(context: ResolvedContext): string {
	return `--- CONTEXT: ${context.contextFileDisplayPath} ---\n${context.content}\n\n${context.marker}`;
}

export function malformedNotice(context: ResolvedContext): string {
	return `--- CONTEXT: ${context.contextFileDisplayPath} could not be loaded because ${context.diagnostic}. Its constraints are not enforced until it is fixed. ---`;
}

export function gateRefusal(context: ResolvedContext): string {
	const contextFile = context.contextFileDisplayPath;
	const target = context.isContextFile ? contextFile : context.displayPath;
	return [
		`Context Gate Blocked: Cannot modify \`${target}\` because its architectural constraints in \`${contextFile}\` are not loaded (or are out of date) in your current context.`,
		`Action required: Call \`read\` on \`${contextFile}\` (or \`${context.displayPath}\`) first, review its invariants and hazards, and then retry your modification.`,
	].join("\n");
}
