import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, isAbsolute, relative, sep } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export const SIDECAR_SUFFIX = ".context";

/** Tool results that can carry a marker; anything else that quotes one does not count as delivery. */
const DELIVERING_TOOLS = new Set(["read", "edit", "write"]);

export type SidecarStatus = "no_sidecar" | "live" | "missing" | "malformed";

export interface SidecarContext {
	status: SidecarStatus;
	sourcePath: string;
	sidecarPath: string;
	/** Source path as markers and messages show it: relative to the working directory when inside it. */
	displayPath: string;
	content?: string;
	marker?: string;
	diagnostic?: string;
}

export function isSidecarPath(path: string): boolean {
	return path.endsWith(SIDECAR_SUFFIX) && basename(path) !== SIDECAR_SUFFIX;
}

function displayPath(path: string, cwd: string): string {
	const local = relative(cwd, path);
	return local && !local.startsWith("..") && !isAbsolute(local) ? local.split(sep).join("/") : path;
}

export function contextRef(displayPath: string, content: string): string {
	const hash = createHash("sha256").update(content).digest("hex");
	return `<context-ref path="${displayPath}" hash="sha256:${hash}" />`;
}

export function isMarkerLive(marker: string, messages: readonly AgentMessage[]): boolean {
	return messages.some(
		(message) =>
			message.role === "toolResult" &&
			DELIVERING_TOOLS.has(message.toolName) &&
			message.content.some((block) => block.type === "text" && block.text.includes(marker)),
	);
}

function loadSidecar(sidecarPath: string): { content?: string; diagnostic?: string } | undefined {
	let bytes: Buffer;
	try {
		bytes = readFileSync(sidecarPath);
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

/** The sidecar that governs `path` (a source file or its sidecar) and whether its current marker is in `messages`. */
export function resolveContext(path: string, cwd: string, messages: readonly AgentMessage[]): SidecarContext {
	const sourcePath = isSidecarPath(path) ? path.slice(0, -SIDECAR_SUFFIX.length) : path;
	const sidecarPath = `${sourcePath}${SIDECAR_SUFFIX}`;
	const shown = displayPath(sourcePath, cwd);
	const base = { sourcePath, sidecarPath, displayPath: shown };
	const loaded = loadSidecar(sidecarPath);
	if (!loaded) return { ...base, status: "no_sidecar" };
	if (loaded.content === undefined) return { ...base, status: "malformed", diagnostic: loaded.diagnostic };
	const marker = contextRef(shown, loaded.content);
	return { ...base, status: isMarkerLive(marker, messages) ? "live" : "missing", content: loaded.content, marker };
}

export function contextBlock(context: SidecarContext): string {
	return `--- CONTEXT: ${context.displayPath}${SIDECAR_SUFFIX} ---\n${context.content}\n\n${context.marker}`;
}

export function malformedNotice(context: SidecarContext): string {
	return `--- CONTEXT: ${context.displayPath}${SIDECAR_SUFFIX} could not be loaded because ${context.diagnostic}. Its constraints are not enforced until it is fixed. ---`;
}

export function gateRefusal(context: SidecarContext, targetIsSidecar: boolean): string {
	const sidecar = `${context.displayPath}${SIDECAR_SUFFIX}`;
	const target = targetIsSidecar ? sidecar : context.displayPath;
	return [
		`Context Gate Blocked: Cannot modify \`${target}\` because its architectural constraints in \`${sidecar}\` are not loaded (or are out of date) in your current context.`,
		`Action required: Call \`read\` on \`${sidecar}\` (or \`${context.displayPath}\`) first, review its invariants and hazards, and then retry your modification.`,
	].join("\n");
}
