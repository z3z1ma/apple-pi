import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { connectRuntime } from "../../session-state/src/client.js";
import { statePaths } from "../../session-state/src/paths.js";
import { lineReader, type ReadEntry, type SearchTranscripts } from "../../session-state/src/protocol.js";
import type { SearchHit as IndexedHit } from "../../session-state/src/transcript-index.hot.js";
import { readTranscriptEntries } from "../../session-state/src/transcript-read.hot.js";
import { expandSourceEntry } from "./drill-down.js";
import { formatRecallOutput } from "./format-recall.js";
import { renderSource, sourceContext } from "./load-messages.js";
import { describeSearchHit, filterStopwords, type SearchHit } from "./search-entries.js";

export interface RecallRecord {
	id: string;
	type: string;
	parentId?: string | null;
	timestamp?: string;
	message?: any;
	[key: string]: any;
}

type AttributedHit = IndexedHit & { file: string | null; name: string | null; task?: string };

export class RecallRefusal extends Error {}

/** Connect only to the configured socket: recall neither starts a daemon nor changes the corpus. */
async function requestRuntime(request: SearchTranscripts | ReadEntry, signal?: AbortSignal): Promise<any> {
	signal?.throwIfAborted();
	const socket = await connectRuntime(signal, statePaths().socket);
	let abort = () => {};
	try {
		signal?.throwIfAborted();
		return await new Promise((resolve, reject) => {
			abort = () => reject(signal?.reason ?? new Error("Recall cancelled."));
			signal?.addEventListener("abort", abort, { once: true });
			socket.on("error", reject);
			socket.on("close", () => reject(new Error("The transcript runtime closed the connection.")));
			socket.on(
				"data",
				lineReader((line) => {
					try {
						const reply = JSON.parse(line);
						if (reply.requestId !== request.requestId) return;
						if (reply.type !== (request.type === "read_entry" ? "entry" : "transcript_hits"))
							throw new Error("The transcript runtime returned an unexpected response.");
						if (typeof reply.error === "string")
							throw reply.refused === true ? new RecallRefusal(reply.error) : new Error(reply.error);
						resolve(reply);
					} catch (error) {
						reject(error);
					}
				}),
			);
			socket.write(`${JSON.stringify(request)}\n`);
		});
	} finally {
		signal?.removeEventListener("abort", abort);
		socket.destroy();
	}
}

function renderIndexedSource(entry: RecallRecord, ordinal: number | null, full = false) {
	const existing = renderSource(entry, ordinal ?? undefined, full);
	if (!existing) throw new Error(`Indexed entry ${entry.id} has no supported source body.`);
	return existing;
}

export async function readQualifiedEntry(
	request: { id: string; offset: number; limit: number },
	caller: string,
	signal?: AbortSignal,
): Promise<string> {
	const slash = request.id.indexOf("/");
	const sessionId = request.id.slice(0, slash);
	const entryId = request.id.slice(slash + 1);
	if (!sessionId || !entryId) throw new Error("Use entry:<session>/<id> for a qualified source.");
	const reply = await requestRuntime(
		{ type: "read_entry", requestId: randomUUID(), caller, sessionId, entryId },
		signal,
	);
	const entry = reply.entry as RecallRecord;
	if (!entry || entry.id !== entryId) throw new Error("The transcript runtime did not return the requested entry.");
	// The numeric ordinal belongs to that transcript; source recovery uses its globally qualified identity.
	const source = renderSource(entry, entry.type === "message" && entry.message ? 0 : undefined, true);
	if (!source) throw new RecallRefusal(`Indexed entry ${entry.id} has no supported source body.`);
	const rendered = source.display;
	return expandSourceEntry(
		[{ ...rendered, entryId: request.id, timestamp: entry.timestamp, sourceKind: rendered.sourceKind ?? "message" }],
		request,
	);
}

export async function searchIndexedHistory(options: {
	query: string;
	toolCallId: string;
	caller: string;
	entries: RecallRecord[];
	activeEntryIds: Set<string>;
	scope: "lineage" | "all";
	tasks?: string[];
	fields?: "words" | "all";
	page: number;
	pageSize: number;
	maxPages: number;
	signal?: AbortSignal;
}) {
	const { caller, entries, activeEntryIds, scope, query, signal, page, pageSize, maxPages } = options;
	const excluded = entries
		.filter((entry) => scope === "lineage" && !activeEntryIds.has(entry.id))
		.map((entry) => entry.id);
	const issuer = entries
		.filter(
			(entry) =>
				entry.type === "message" &&
				entry.message?.role === "assistant" &&
				Array.isArray(entry.message.content) &&
				entry.message.content.some(
					(part: any) =>
						part.type === "toolCall" &&
						(part.id === options.toolCallId || options.toolCallId.startsWith(`${part.id}/`)),
				),
		)
		.map((entry) => entry.id);
	const reply = await requestRuntime(
		{
			type: "search_transcripts",
			requestId: randomUUID(),
			query: filterStopwords(query.trim().split(/\s+/)).join(" "),
			caller,
			...(options.tasks?.length ? { tasks: options.tasks } : { sessions: [caller] }),
			fields: options.fields ?? "all",
			exclude: [{ session: caller, entries: [...new Set([...excluded, ...issuer])] }],
			limit: pageSize,
			offset: (page - 1) * pageSize,
		},
		signal,
	);
	if (!Array.isArray(reply.hits) || !Number.isSafeInteger(reply.total) || reply.total < 0)
		throw new Error("The transcript runtime returned an invalid search page.");
	const hits = reply.hits as AttributedHit[];
	const total = reply.total as number;
	const totalPages = Math.ceil(total / pageSize);
	const scopeLabel = scope === "all" ? " (scope: all)" : "";
	if (total && page > Math.min(totalPages, maxPages))
		return {
			text: `Too many results to page through (${total} matches across ${totalPages} pages). Try a more specific query${scopeLabel}.`,
			sources: [],
		};
	const byFile = new Map<string, AttributedHit[]>();
	for (const hit of hits) {
		if (!hit.file) throw new Error(`No transcript file is available for indexed source ${hit.session}/${hit.entry}.`);
		const selected = byFile.get(hit.file) ?? [];
		selected.push(hit);
		byFile.set(hit.file, selected);
	}
	const bodies = new Map<string, Map<string, unknown>>();
	for (const [file, selected] of byFile) {
		signal?.throwIfAborted();
		const handle = await open(file, "r");
		const found = new Map<string, unknown>();
		try {
			for (const hit of selected) {
				signal?.throwIfAborted();
				const buffer = Buffer.allocUnsafe(hit.length);
				const { bytesRead } = await handle.read(buffer, 0, hit.length, hit.offset);
				let entry: RecallRecord | undefined;
				if (bytesRead === hit.length) {
					try {
						entry = JSON.parse(buffer.toString("utf8"));
					} catch {}
				}
				if (entry?.id !== hit.entry)
					entry = (await readTranscriptEntries(file, new Map([[hit.entry, hit.at]]))).found.get(hit.entry) as
						| RecallRecord
						| undefined;
				if (!entry || entry.id !== hit.entry)
					throw new Error(`Indexed source ${hit.session}/${hit.entry} is unavailable in its transcript.`);
				found.set(hit.entry, entry);
			}
		} finally {
			await handle.close();
		}
		bodies.set(file, found);
	}
	const records = new Map(entries.map((entry) => [entry.id, entry]));
	const questions = new Map<string | null | undefined, RecallRecord | undefined>();
	for (const entry of entries)
		questions.set(
			entry.id,
			entry.message?.role === "user" || entry.type === "custom_message" ? entry : questions.get(entry.parentId),
		);
	const rendered: SearchHit[] = hits.map((hit) => {
		const entry = bodies.get(hit.file!)?.get(hit.entry) as RecallRecord | undefined;
		if (!entry || entry.id !== hit.entry)
			throw new Error(`Indexed source ${hit.session}/${hit.entry} is unavailable in its transcript.`);
		const source = renderIndexedSource(entry, hit.ordinal);
		const local = hit.session === caller;
		const context = local
			? sourceContext(
					entry,
					source.message,
					questions.get(entry.parentId),
					records,
					scope === "lineage" ? activeEntryIds : undefined,
				)
			: [];
		const qualified = !local;
		const described = describeSearchHit(
			{
				...source.display,
				entryId: hit.entry,
				timestamp: entry.timestamp,
				parentId: entry.parentId,
				sourceKind: source.display.sourceKind ?? "message",
				customType: entry.customType,
				lineage: local ? (activeEntryIds.has(hit.entry) ? "active" : "off-lineage") : undefined,
				...(context.length ? { context } : {}),
				...(qualified ? { sourceSession: hit.session, sourceName: hit.name ?? hit.session } : {}),
				...(hit.task ? { task: hit.task } : {}),
			},
			source.message,
			query,
			hit.snippet,
		);
		return { ...described, turnId: `${hit.session}/${hit.entry}` };
	});
	const header =
		totalPages > 1
			? `Page ${page}/${totalPages} (${total} total matches${scopeLabel})`
			: `${total} matches${scopeLabel}`;
	const footer =
		page < totalPages && page < maxPages
			? `\n--- Use page:${page + 1} for more results ---`
			: totalPages > maxPages
				? `\n--- Results truncated at ${maxPages} pages. Use a more specific query or scope to narrow results. ---`
				: "";
	return {
		text: formatRecallOutput(rendered, query, header) + footer,
		sources: hits.map((hit, i) => ({
			entryId: hit.entry,
			index: hit.ordinal ?? undefined,
			timestamp: rendered[i]?.timestamp,
			sourceKind: rendered[i]?.sourceKind,
			lineage: rendered[i]?.lineage,
			session: hit.session,
			name: hit.name,
			task: hit.task,
		})),
	};
}
