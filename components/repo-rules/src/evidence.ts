import { join } from "node:path";
import { defineTool, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { sessionEntries } from "../../shared/src/session-logs.js";
import { byInstant, repositoryRoot, windowStart } from "./replay.js";

export const SESSION_EVIDENCE_TOOL_NAME = "session_evidence";
export const EVIDENCE_KINDS = ["learning", "refusal", "failure", "program_call"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

const TEXT_MAX = 600;

export interface EvidenceItem {
	kind: EvidenceKind;
	at: string;
	ref: string;
	file: string;
	tool?: string;
	text: string;
}

function nestedProgramCalls(details: unknown): string[] {
	const calls = (details as { calls?: { name?: unknown }[] } | undefined)?.calls;
	if (!Array.isArray(calls)) return [];
	return calls.flatMap((call) =>
		typeof call?.name === "string" && call.name.startsWith("program_") ? [call.name] : [],
	);
}

const NOTEBOOK = ["notebook.maintenance", "notebook.reflections.recorded"];

function textOf(content: unknown): string {
	if (!Array.isArray(content)) return typeof content === "string" ? content : "";
	return content
		.map((part: { type?: string; text?: string }) => (part?.type === "text" ? (part.text ?? "") : ""))
		.join("\n");
}

const clipped = (text: string) => (text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX - 1)}\u2026` : text);

export async function sessionEvidence(options: {
	root: string;
	since: number;
	sessionsDir: string;
	kinds: readonly EvidenceKind[];
}): Promise<{ sessions: number; items: EvidenceItem[] }> {
	const wanted = new Set(options.kinds);
	const sessions = new Set<string>();
	const notes = new Set<string>();
	const items: EvidenceItem[] = [];
	for await (const { session, entry } of sessionEntries({
		...options,
		wanted: (line) => line.includes('"notebook.') || line.includes('"isError":true') || line.includes("program_"),
	})) {
		sessions.add(session.id);
		const at = entry.timestamp as string;
		const ref = `entry:${session.id}/${entry.id}`;
		const file = session.file;
		if (entry.type === "custom" && NOTEBOOK.includes(String(entry.customType))) {
			if (!wanted.has("learning")) continue;
			const data = entry.data as { reflections?: { id?: string; content?: string }[] } | undefined;
			for (const note of data?.reflections ?? []) {
				if (typeof note.id !== "string" || typeof note.content !== "string" || notes.has(note.id)) continue;
				notes.add(note.id);
				items.push({ kind: "learning", at, ref, file, text: clipped(note.content) });
			}
			continue;
		}
		if (entry.type !== "message") continue;
		const message = entry.message as {
			role?: string;
			toolName?: string;
			isError?: boolean;
			content?: { type?: string; name?: string }[];
			details?: unknown;
		};
		if (message.role === "toolResult" && wanted.has("program_call"))
			for (const name of nestedProgramCalls(message.details))
				items.push({ kind: "program_call", at, ref, file, tool: name, text: name });
		if (message.role === "toolResult" && message.isError === true) {
			const text = textOf(message.content).trim();
			const refused = text.startsWith("Refused");
			if (refused ? !wanted.has("refusal") : !wanted.has("failure") || message.toolName === "bash") continue;
			items.push({ kind: refused ? "refusal" : "failure", at, ref, file, tool: message.toolName, text: clipped(text) });
			continue;
		}
		if (message.role === "assistant" && wanted.has("program_call") && Array.isArray(message.content))
			for (const part of message.content)
				if (part?.type === "toolCall" && part.name?.startsWith("program_"))
					items.push({ kind: "program_call", at, ref, file, tool: part.name, text: part.name });
	}
	items.sort(byInstant);
	return { sessions: sessions.size, items };
}

export function createEvidenceTool() {
	return defineTool({
		name: SESSION_EVIDENCE_TOOL_NAME,
		label: "Session evidence",
		description:
			"List what this repository's sessions recorded since a date or commit: notebook learnings, refusals by rules and guards, failed tool calls (not shell exits), and saved-program calls, each with a search_session entry reference. Read-only.",
		parameters: Type.Object(
			{
				since: Type.String({
					minLength: 1,
					description: "Window start: a date or a git revision, usually the last change to the surface in question.",
				}),
				kinds: Type.Optional(
					Type.Array(Type.Union(EVIDENCE_KINDS.map((kind) => Type.Literal(kind))), {
						description: "Which kinds to read; all by default.",
					}),
				),
				limit: Type.Integer({ minimum: 1, description: "Items per page, oldest first." }),
				offset: Type.Optional(Type.Integer({ minimum: 0, description: "Items to skip." })),
			},
			{ additionalProperties: false },
		),
		async execute(_id, params, _signal, _update, ctx) {
			const root = await repositoryRoot(ctx.cwd);
			const since = await windowStart(root, params.since);
			const kinds = params.kinds?.length ? params.kinds : EVIDENCE_KINDS;
			const { sessions, items } = await sessionEvidence({
				root,
				since,
				sessionsDir: join(getAgentDir(), "sessions"),
				kinds,
			});
			const offset = params.offset ?? 0;
			const page = items.slice(offset, offset + params.limit);
			const counts = kinds.map((kind) => `${items.filter((item) => item.kind === kind).length} ${kind}`).join(", ");
			const lines = [
				`${sessions} sessions of ${root} since ${new Date(since).toISOString()} (${params.since}): ${counts}.`,
				`Items ${page.length ? `${offset + 1}-${offset + page.length}` : "none"} of ${items.length}:`,
				...page.map(
					(item) =>
						`- ${item.at} ${item.kind}${item.tool ? ` ${item.tool}` : ""} ${item.ref} in ${item.file}: ${item.text}`,
				),
			];
			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: { sessions, total: items.length, offset, items: page },
			};
		},
	});
}
