import { randomBytes } from "node:crypto";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const EXPAND_RECEIPT_TOOL_NAME = "expand_receipt";
export const RECEIPT_UNAVAILABLE_TEXT = "Receipt is not available.";

/** Primary-visible omitted payload captured at issue time. Text is paged; images pass through. */
export type PairReceiptImage = {
	readonly type: "image";
	readonly data: string;
	readonly mimeType: string;
};

export type PairReceiptSnapshot = {
	readonly text: string;
	readonly images?: readonly PairReceiptImage[];
};

export type ExpandReceiptDetails =
	| { readonly status: "unavailable" }
	| {
			readonly status: "ok";
			readonly truncated: boolean;
			readonly continuationId?: string;
	  };

type FrozenSnapshot = {
	readonly text: string;
	readonly images: readonly PairReceiptImage[];
};

type StoredReceipt = {
	readonly handle: string;
	readonly snapshot: FrozenSnapshot;
	readonly sourceEntryIds: readonly string[];
	readonly originHandle: string;
	readonly textOffset: number;
};

export type PairReceiptStoreOptions = {
	isActiveSourceEntry: (sourceEntryId: string) => boolean;
};

export type PairReceiptRequest =
	| {
			readonly kind: "tool";
			readonly callId: string;
			readonly sources: "call" | "result" | "interaction";
			readonly snapshot: PairReceiptSnapshot;
	  }
	| { readonly kind: "bash"; readonly sourceEntryId: string; readonly snapshot: PairReceiptSnapshot }
	| { readonly kind: "user"; readonly sourceEntryId: string; readonly snapshot: PairReceiptSnapshot };

export type PairReceiptIssuer = (request: PairReceiptRequest) => string | undefined;

type ReceiptSourceEntry = {
	readonly id: string;
	readonly type: string;
	readonly message?: unknown;
};

function freezeIds(sourceEntryIds: readonly string[]): readonly string[] {
	if (sourceEntryIds.length === 0) {
		throw new Error("Receipt source entry ids must be non-empty.");
	}
	const ids = sourceEntryIds.map((id) => {
		if (typeof id !== "string" || id.length === 0) {
			throw new Error("Receipt source entry ids must be non-empty.");
		}
		return id;
	});
	return Object.freeze(ids);
}

function freezeSnapshot(snapshot: PairReceiptSnapshot): FrozenSnapshot {
	if (!snapshot || typeof snapshot.text !== "string") {
		throw new Error("Receipt snapshot text is required.");
	}
	const images = Object.freeze(
		(snapshot.images ?? []).map((image) =>
			Object.freeze({
				type: "image" as const,
				data: image.data,
				mimeType: image.mimeType,
			}),
		),
	);
	return Object.freeze({ text: snapshot.text, images });
}

function sourceLabels(ids: readonly string[]): string {
	return ids.map((id) => `[Source entry id: ${id}]`).join("\n");
}

function continuationNotice(id: string): string {
	return `\n\n[Receipt continues: expand_receipt({ id: ${JSON.stringify(id)} })]`;
}

function utf8ByteLength(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

/** Exclusive UTF-8 byte index that does not split a code point. */
function utf8ClipEnd(encoded: Buffer, maxBytes: number): number {
	if (encoded.length <= maxBytes) return encoded.length;
	let end = Math.max(0, maxBytes);
	while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end--;
	return end;
}

function utf8SafePrefix(text: string, maxBytes: number): string {
	if (maxBytes <= 0 || text.length === 0) return "";
	const encoded = Buffer.from(text, "utf8");
	const end = utf8ClipEnd(encoded, maxBytes);
	return encoded.subarray(0, end).toString("utf8");
}

/**
 * Exact-slice page of historical text using Pi's exported line/byte caps.
 * Concatenating successive fragments reconstructs the original string.
 */
function takeReceiptPage(
	text: string,
	maxBytes: number = DEFAULT_MAX_BYTES,
	maxLines: number = DEFAULT_MAX_LINES,
): { fragment: string; rest: string } {
	if (text.length === 0) return { fragment: "", rest: "" };
	if (utf8ByteLength(text) <= maxBytes) {
		let lines = 0;
		for (let i = 0; i < text.length; i++) {
			if (text.charCodeAt(i) === 10) lines++;
		}
		if (!text.endsWith("\n")) lines++;
		if (lines <= maxLines) return { fragment: text, rest: "" };
	}

	let index = 0;
	let takenLines = 0;
	let takenBytes = 0;
	while (index < text.length && takenLines < maxLines) {
		const newline = text.indexOf("\n", index);
		const lineEnd = newline === -1 ? text.length : newline + 1;
		const piece = text.slice(index, lineEnd);
		const pieceBytes = utf8ByteLength(piece);
		if (takenBytes + pieceBytes > maxBytes) {
			if (takenBytes === 0) {
				const prefix = utf8SafePrefix(piece, maxBytes);
				return { fragment: prefix, rest: text.slice(prefix.length) };
			}
			break;
		}
		takenBytes += pieceBytes;
		takenLines += 1;
		index = lineEnd;
	}
	return { fragment: text.slice(0, index), rest: text.slice(index) };
}

function unavailable(): AgentToolResult<ExpandReceiptDetails> {
	return {
		content: [{ type: "text", text: RECEIPT_UNAVAILABLE_TEXT }],
		details: { status: "unavailable" },
	};
}

/**
 * Host-owned issuer for omitted primary-visible payloads.
 * Handles are opaque, store-local, and redeemable only against historical snapshots.
 */
export class PairReceiptStore {
	private readonly isActiveSourceEntry: (sourceEntryId: string) => boolean;
	private readonly byHandle = new Map<string, StoredReceipt>();
	private readonly byKey = new Map<string, string>();
	private readonly presentedHandles = new Set<string>();
	private revoked = false;

	constructor(options: PairReceiptStoreOptions) {
		this.isActiveSourceEntry = options.isActiveSourceEntry;
	}

	issue(snapshot: PairReceiptSnapshot, dedupeKey: string, sourceEntryIds: readonly string[]): string {
		this.assertOpen();
		if (typeof dedupeKey !== "string" || dedupeKey.length === 0) {
			throw new Error("Receipt dedupe key must be non-empty.");
		}
		const existing = this.byKey.get(dedupeKey);
		if (existing) return existing;
		return this.intern(dedupeKey, freezeSnapshot(snapshot), freezeIds(sourceEntryIds), 0);
	}

	/** Activate only handles that have crossed the pair's prompt boundary. */
	activatePresented(text: string): void {
		if (this.revoked || !text) return;
		for (const match of text.matchAll(/(?:^|\n)receipt: ([0-9a-f]{32})(?=\n|$)/g)) {
			const handle = match[1];
			if (handle && this.byHandle.has(handle)) this.presentedHandles.add(handle);
		}
	}

	revoke(): void {
		this.revoked = true;
		this.byHandle.clear();
		this.byKey.clear();
		this.presentedHandles.clear();
	}

	expand(id: string): AgentToolResult<ExpandReceiptDetails> {
		if (this.revoked || typeof id !== "string" || id.length === 0) return unavailable();
		const record = this.byHandle.get(id);
		if (!record || !this.presentedHandles.has(id)) return unavailable();
		if (!record.sourceEntryIds.every((sourceId) => this.isActiveSourceEntry(sourceId))) {
			return unavailable();
		}

		const remaining = record.snapshot.text.slice(record.textOffset);
		const labels = sourceLabels(record.sourceEntryIds);
		const continuationBytes = utf8ByteLength(continuationNotice("0".repeat(32)));
		const contentBytes = Math.max(4, DEFAULT_MAX_BYTES - utf8ByteLength(`${labels}\n`) - continuationBytes);
		// A fragment ending in "\n" contributes one implicit empty line before
		// the two-newline continuation separator, so reserve three suffix lines.
		const contentLines = Math.max(1, DEFAULT_MAX_LINES - record.sourceEntryIds.length - 3);
		const { fragment, rest } = takeReceiptPage(remaining, contentBytes, contentLines);
		let text = `${labels}\n${fragment}`;
		let continuationId: string | undefined;
		if (rest.length > 0) {
			const nextOffset = record.textOffset + fragment.length;
			continuationId = this.continuationHandle(record, nextOffset);
			text += continuationNotice(continuationId);
			// The continuation capability is presented in this tool result.
			this.presentedHandles.add(continuationId);
		}

		const content: AgentToolResult<ExpandReceiptDetails>["content"] = [{ type: "text", text }];
		if (record.textOffset === 0) {
			for (const image of record.snapshot.images) {
				content.push({ type: "image", data: image.data, mimeType: image.mimeType });
			}
		}

		return {
			content,
			details: continuationId ? { status: "ok", truncated: true, continuationId } : { status: "ok", truncated: false },
		};
	}

	private assertOpen(): void {
		if (this.revoked) throw new Error("Receipt store has been revoked.");
	}

	private intern(
		dedupeKey: string,
		snapshot: FrozenSnapshot,
		sourceEntryIds: readonly string[],
		textOffset: number,
		originHandle?: string,
	): string {
		const existing = this.byKey.get(dedupeKey);
		if (existing) return existing;
		const handle = this.mintHandle();
		const record: StoredReceipt = {
			handle,
			snapshot,
			sourceEntryIds,
			originHandle: originHandle ?? handle,
			textOffset,
		};
		this.byKey.set(dedupeKey, handle);
		this.byHandle.set(handle, record);
		return handle;
	}

	private continuationHandle(record: StoredReceipt, nextOffset: number): string {
		this.assertOpen();
		const key = `\0continuation\0${record.originHandle}\0${nextOffset}`;
		return this.intern(key, record.snapshot, record.sourceEntryIds, nextOffset, record.originHandle);
	}

	private mintHandle(): string {
		for (;;) {
			const handle = randomBytes(16).toString("hex");
			if (!this.byHandle.has(handle)) return handle;
		}
	}
}

function toolCallIds(message: AssistantMessage): string[] {
	return message.content.flatMap((part) =>
		part.type === "toolCall" && typeof (part as { id?: unknown }).id === "string" ? [(part as { id: string }).id] : [],
	);
}

/**
 * Bind receipt issuance to the immutable primary entries already projected into
 * one trajectory view. The formatter can fold content, but it cannot mint a
 * capability for an entry the driver never exposed on the active lineage.
 */
export function createPairReceiptIssuer(
	store: PairReceiptStore,
	entries: readonly ReceiptSourceEntry[],
): PairReceiptIssuer {
	const callSourceIds = new Map<string, string[]>();
	const resultSourceIds = new Map<string, string[]>();
	const visibleBashIds = new Set<string>();
	const visibleUserIds = new Set<string>();
	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message || typeof entry.message !== "object") continue;
		const message = entry.message as { role?: string; excludeFromContext?: boolean };
		if (message.role === "assistant") {
			for (const callId of toolCallIds(entry.message as AssistantMessage)) {
				const ids = callSourceIds.get(callId) ?? [];
				ids.push(entry.id);
				callSourceIds.set(callId, ids);
			}
		} else if (message.role === "toolResult") {
			const callId = (entry.message as ToolResultMessage).toolCallId;
			if (typeof callId === "string" && callId) {
				const ids = resultSourceIds.get(callId) ?? [];
				ids.push(entry.id);
				resultSourceIds.set(callId, ids);
			}
		} else if (message.role === "bashExecution" && !message.excludeFromContext) {
			visibleBashIds.add(entry.id);
		} else if (message.role === "user") {
			visibleUserIds.add(entry.id);
		}
	}

	return (request) => {
		if (request.kind === "bash") {
			if (!visibleBashIds.has(request.sourceEntryId)) return undefined;
			return store.issue(request.snapshot, `bash:${request.sourceEntryId}`, [request.sourceEntryId]);
		}
		if (request.kind === "user") {
			if (!visibleUserIds.has(request.sourceEntryId)) return undefined;
			return store.issue(request.snapshot, `user:${request.sourceEntryId}`, [request.sourceEntryId]);
		}
		const callIds = callSourceIds.get(request.callId) ?? [];
		const resultIds = resultSourceIds.get(request.callId) ?? [];
		const sourceEntryIds =
			request.sources === "call" ? callIds : request.sources === "result" ? resultIds : [...callIds, ...resultIds];
		if (sourceEntryIds.length === 0) return undefined;
		return store.issue(
			request.snapshot,
			`tool:${request.sources}:${sourceEntryIds.join(":")}:${request.callId}`,
			sourceEntryIds,
		);
	};
}

const expandReceiptParameters = Type.Object(
	{
		id: Type.String({
			minLength: 1,
			description: "Opaque receipt handle from the shared trajectory or a previous expansion.",
		}),
	},
	{ additionalProperties: false },
);

export function createExpandReceiptTool(
	store: PairReceiptStore,
): ToolDefinition<typeof expandReceiptParameters, ExpandReceiptDetails> {
	return defineTool({
		name: EXPAND_RECEIPT_TOOL_NAME,
		label: "Expand receipt",
		description:
			"Open the omitted historical payload for one receipt handle already shown in the shared trajectory. " +
			"Pass only that opaque id. This returns the snapshot captured then, not current files, commands, or a search.",
		promptSnippet: "expand_receipt({ id }) opens a collapsed payload already shown on the shared trajectory.",
		promptGuidelines: [
			"Use expand_receipt only with an opaque id already shown in the shared trajectory or a previous expansion.",
			"Expand when the folded payload could materially affect your judgment or answer a question you would otherwise ask your partner; leave irrelevant receipts folded.",
			"Keep expansion focused on the already-presented trajectory; repository navigation remains with your partner and the consultant.",
		],
		parameters: expandReceiptParameters,
		async execute(_toolCallId, params, signal) {
			signal?.throwIfAborted();
			return store.expand(params.id);
		},
	});
}
