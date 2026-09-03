import { randomBytes } from "node:crypto";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { formatActiveSessionContext, formatUserMessage } from "../src/formatting.js";
import {
	createExpandReceiptTool,
	createPairReceiptIssuer,
	EXPAND_RECEIPT_TOOL_NAME,
	type ExpandReceiptDetails,
	PairReceiptStore,
	RECEIPT_UNAVAILABLE_TEXT,
} from "../src/receipt-expansion.js";
import { buildPairSeed, collectRecentUserRequests, formatSourceAddressedTrajectory } from "../src/seed.js";

function storeWith(active: ReadonlySet<string> | ((id: string) => boolean)): PairReceiptStore {
	const predicate = typeof active === "function" ? active : (id: string) => active.has(id);
	return new PairReceiptStore({ isActiveSourceEntry: predicate });
}

async function expand(store: PairReceiptStore, id: string) {
	const tool = createExpandReceiptTool(store);
	return tool.execute("call", { id }, undefined, undefined, {} as never);
}

function present(store: PairReceiptStore, id: string): void {
	store.activatePresented(`receipt: ${id}`);
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text as string)
		.join("");
}

function pageBody(
	result: Awaited<ReturnType<typeof expand>>,
	sourceEntryIds: readonly string[],
): { body: string; continuationId?: string; truncated: boolean } {
	const header = `${sourceEntryIds.map((id) => `[Source entry id: ${id}]`).join("\n")}\n`;
	const text = textOf(result);
	expect(text.startsWith(header)).toBe(true);
	let body = text.slice(header.length);
	const details = result.details as ExpandReceiptDetails;
	expect(details.status).toBe("ok");
	if (details.status !== "ok") throw new Error("expected ok receipt");
	if (details.continuationId) {
		const notice = `\n\n[Receipt continues: expand_receipt({ id: ${JSON.stringify(details.continuationId)} })]`;
		expect(body.endsWith(notice)).toBe(true);
		body = body.slice(0, -notice.length);
	}
	return { body, continuationId: details.continuationId, truncated: details.truncated };
}

describe("pair receipt expansion", () => {
	it("exposes only an id parameter", () => {
		const tool = createExpandReceiptTool(storeWith(new Set(["e1"])));
		expect(tool.name).toBe(EXPAND_RECEIPT_TOOL_NAME);
		expect(Object.keys(tool.parameters.properties)).toEqual(["id"]);
		expect(tool.parameters.properties).not.toHaveProperty("path");
		expect(tool.parameters.properties).not.toHaveProperty("query");
		expect(tool.parameters.properties).not.toHaveProperty("branch");
		expect(tool.parameters.properties).not.toHaveProperty("scope");
		expect(tool.parameters.properties).not.toHaveProperty("offset");
		expect(tool.parameters.properties).not.toHaveProperty("limit");
	});

	it("issues opaque handles that do not embed keys, source ids, or payload", () => {
		const store = storeWith(new Set(["src-entry-alpha"]));
		const snapshot = { text: "omitted /tmp/secret.ts body" };
		const handle = store.issue(snapshot, "dedupe:read:/tmp/secret.ts", ["src-entry-alpha"]);
		expect(handle).toMatch(/^[0-9a-f]{32}$/);
		expect(handle).not.toContain("dedupe");
		expect(handle).not.toContain("secret");
		expect(handle).not.toContain("src-entry");
		expect(handle).not.toContain("/");
	});

	it("returns the existing handle when the same dedupe key is reissued", async () => {
		const store = storeWith(new Set(["e1"]));
		const first = store.issue({ text: "original" }, "same-key", ["e1"]);
		const second = store.issue({ text: "ignored later snapshot" }, "same-key", ["e1"]);
		expect(second).toBe(first);
		present(store, first);
		const page = pageBody(await expand(store, first), ["e1"]);
		expect(page.body).toBe("original");
		expect(page.body).not.toContain("ignored later snapshot");
	});

	it("keeps issued snapshots immutable after the caller mutates its object", async () => {
		const store = storeWith(new Set(["e1"]));
		const snapshot = {
			text: "stable",
			images: [{ type: "image" as const, data: "abc", mimeType: "image/png" }],
		};
		const handle = store.issue(snapshot, "k", ["e1"]);
		snapshot.text = "mutated";
		snapshot.images[0]!.data = "zzz";
		present(store, handle);
		const result = await expand(store, handle);
		expect(pageBody(result, ["e1"]).body).toBe("stable");
		expect(result.content.some((part) => part.type === "image" && part.data === "abc")).toBe(true);
		expect(result.content.some((part) => part.type === "image" && part.data === "zzz")).toBe(false);
	});

	it("fails closed with one generic message for unknown, guessed, cross-store, and revoked handles", async () => {
		const alpha = storeWith(new Set(["e1"]));
		const beta = storeWith(new Set(["e1"]));
		const handle = alpha.issue({ text: "private" }, "k", ["e1"]);
		const guessed = randomBytes(16).toString("hex");

		const beforePresentation = await expand(alpha, handle);
		const unknown = await expand(alpha, "not-a-receipt");
		const guessedResult = await expand(alpha, guessed);
		const crossStore = await expand(beta, handle);
		alpha.revoke();
		const revoked = await expand(alpha, handle);

		for (const result of [beforePresentation, unknown, guessedResult, crossStore, revoked]) {
			expect(textOf(result)).toBe(RECEIPT_UNAVAILABLE_TEXT);
			expect(result.details).toEqual({ status: "unavailable" });
			expect(textOf(result)).not.toContain("private");
		}
		expect(() => alpha.issue({ text: "later" }, "k2", ["e1"])).toThrow(/revoked/);
	});

	it("rejects expansion when any bound source entry leaves the active lineage", async () => {
		const active = new Set(["e1", "e2"]);
		const store = storeWith(active);
		const handle = store.issue({ text: "lineage-bound" }, "k", ["e1", "e2"]);
		present(store, handle);
		expect(pageBody(await expand(store, handle), ["e1", "e2"]).body).toBe("lineage-bound");

		active.delete("e2");
		const stale = await expand(store, handle);
		expect(textOf(stale)).toBe(RECEIPT_UNAVAILABLE_TEXT);
		expect(textOf(stale)).not.toContain("lineage-bound");

		active.add("e2");
		expect(pageBody(await expand(store, handle), ["e1", "e2"]).body).toBe("lineage-bound");
	});

	it("issues capabilities only for tool calls and visible bash entries in the projected lineage", async () => {
		const active = new Set(["assistant-entry", "result-entry", "bash-entry", "hidden-bash-entry"]);
		const store = storeWith(active);
		const issuer = createPairReceiptIssuer(store, [
			{
				type: "message",
				id: "assistant-entry",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", id: "read-call", name: "read", arguments: { path: "src/a.ts" } }],
				},
			},
			{
				type: "message",
				id: "result-entry",
				message: { role: "toolResult", toolCallId: "read-call", toolName: "read", content: [] },
			},
			{
				type: "message",
				id: "bash-entry",
				message: { role: "bashExecution", command: "npm test", output: "ok" },
			},
			{
				type: "message",
				id: "hidden-bash-entry",
				message: { role: "bashExecution", command: "secret", output: "hidden", excludeFromContext: true },
			},
		]);

		const toolHandle = issuer({
			kind: "tool",
			callId: "read-call",
			sources: "interaction",
			snapshot: { text: "read body" },
		});
		const callHandle = issuer({ kind: "tool", callId: "read-call", sources: "call", snapshot: { text: "call" } });
		const resultHandle = issuer({
			kind: "tool",
			callId: "read-call",
			sources: "result",
			snapshot: { text: "result" },
		});
		const bashHandle = issuer({ kind: "bash", sourceEntryId: "bash-entry", snapshot: { text: "bash body" } });
		expect(
			issuer({ kind: "tool", callId: "unknown", sources: "interaction", snapshot: { text: "no" } }),
		).toBeUndefined();
		expect(issuer({ kind: "bash", sourceEntryId: "hidden-bash-entry", snapshot: { text: "hidden" } })).toBeUndefined();
		for (const handle of [toolHandle, callHandle, resultHandle, bashHandle]) present(store, handle!);
		expect(pageBody(await expand(store, toolHandle!), ["assistant-entry", "result-entry"]).body).toBe("read body");
		expect(pageBody(await expand(store, callHandle!), ["assistant-entry"]).body).toBe("call");
		expect(pageBody(await expand(store, resultHandle!), ["result-entry"]).body).toBe("result");
		expect(pageBody(await expand(store, bashHandle!), ["bash-entry"]).body).toBe("bash body");
	});

	it("keeps an assistant-only source batch expandable without binding the later result", async () => {
		const entries = [
			{
				type: "message",
				id: "assistant-entry",
				message: {
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id: "write-call",
							name: "write",
							arguments: { path: "src/a.ts", content: "historical write body" },
						},
					],
					usage: {},
					stopReason: "toolUse",
					timestamp: 1,
				},
			},
			{
				type: "message",
				id: "result-entry",
				message: {
					role: "toolResult",
					toolCallId: "write-call",
					toolName: "write",
					content: [{ type: "text", text: "written" }],
					isError: false,
					timestamp: 2,
				},
			},
		];
		const store = storeWith(new Set(["assistant-entry", "result-entry"]));
		const rendered = formatSourceAddressedTrajectory(
			entries,
			["assistant-entry"],
			createPairReceiptIssuer(store, entries),
		);
		const handle = rendered.match(/receipt: ([0-9a-f]{32})/)?.[1];
		expect(handle).toBeDefined();
		store.activatePresented(rendered);

		const page = pageBody(await expand(store, handle!), ["assistant-entry"]);
		expect(page.body).toContain("historical write body");
	});

	it("includes original source entry labels on every page", async () => {
		const store = storeWith(new Set(["turn-a", "turn-b"]));
		const handle = store.issue({ text: "visible" }, "k", ["turn-a", "turn-b"]);
		present(store, handle);
		const text = textOf(await expand(store, handle));
		expect(text.startsWith("[Source entry id: turn-a]\n[Source entry id: turn-b]\n")).toBe(true);
		expect(text).toContain("visible");
	});

	it("pages exact Unicode multiline content with stable continuation handles", async () => {
		const sourceIds = ["src-unicode"] as const;
		const store = storeWith(new Set(sourceIds));
		const lines = Array.from(
			{ length: DEFAULT_MAX_LINES + 80 },
			(_, index) => `${index} café 日本語 𝄞 ${"🙂".repeat(3)}`,
		);
		const original = lines.join("\n");
		const handle = store.issue({ text: original }, "unicode", sourceIds);
		present(store, handle);

		const first = await expand(store, handle);
		const firstAgain = await expand(store, handle);
		expect(Buffer.byteLength(textOf(first), "utf8")).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
		expect(textOf(first).split("\n").length).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
		const page1 = pageBody(first, sourceIds);
		const page1Repeat = pageBody(firstAgain, sourceIds);
		expect(page1.truncated).toBe(true);
		expect(page1.continuationId).toEqual(page1Repeat.continuationId);
		expect(page1.body).toBe(page1Repeat.body);
		expect(page1.continuationId).toMatch(/^[0-9a-f]{32}$/);
		expect(page1.continuationId).not.toBe(handle);

		const collected: string[] = [page1.body];
		let next = page1.continuationId;
		let pages = 1;
		while (next) {
			const current = next;
			const once = pageBody(await expand(store, current), sourceIds);
			const twice = pageBody(await expand(store, current), sourceIds);
			expect(twice.continuationId).toBe(once.continuationId);
			expect(twice.body).toBe(once.body);
			expect(textOf(await expand(store, current))).toContain(`[Source entry id: ${sourceIds[0]}]`);
			collected.push(once.body);
			next = once.continuationId;
			pages += 1;
			expect(pages).toBeLessThan(20);
		}

		expect(collected.join("")).toBe(original);
		expect(collected.some((part) => part.includes("日本語"))).toBe(true);
		expect(collected.some((part) => part.includes("🙂"))).toBe(true);
	});

	it("keeps continuation framing inside the line cap for short lines", async () => {
		const store = storeWith(new Set(["e1"]));
		const handle = store.issue({ text: "x\n".repeat(DEFAULT_MAX_LINES + 50) }, "lines", ["e1"]);
		present(store, handle);

		const result = await expand(store, handle);
		expect(result.details).toMatchObject({ status: "ok", truncated: true });
		expect(textOf(result).split("\n").length).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
	});

	it("splits a UTF-8 oversize first line on a code-point boundary", async () => {
		const store = storeWith(new Set(["e1"]));
		const unit = "𝄞";
		const unitBytes = Buffer.byteLength(unit, "utf8");
		const original = unit.repeat(Math.floor(DEFAULT_MAX_BYTES / unitBytes) + 8);
		const handle = store.issue({ text: original }, "bytes", ["e1"]);
		present(store, handle);
		const result = await expand(store, handle);
		const page = pageBody(result, ["e1"]);
		expect(page.truncated).toBe(true);
		expect(Buffer.byteLength(textOf(result), "utf8")).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
		expect(Buffer.byteLength(page.body, "utf8")).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
		expect(page.body.endsWith("\uFFFD")).toBe(false);
		expect(original.startsWith(page.body)).toBe(true);

		const rest = pageBody(await expand(store, page.continuationId!), ["e1"]);
		expect(page.body + rest.body).toBe(original);
	});

	it("issues one user-message receipt bound to the exact active primary user entry", async () => {
		const png = { type: "image" as const, data: "USER_IMG_A", mimeType: "image/png" };
		const jpeg = { type: "image" as const, data: "USER_IMG_B", mimeType: "image/jpeg" };
		const userContent = [
			{ type: "text" as const, text: "see these" },
			png,
			{ type: "text" as const, text: "and this" },
			jpeg,
		];
		const entries = [
			{
				type: "message",
				id: "user-entry",
				message: { role: "user", content: userContent, timestamp: 1 },
			},
			{
				type: "message",
				id: "other-user",
				message: { role: "user", content: [{ type: "image", data: "OTHER", mimeType: "image/png" }], timestamp: 2 },
			},
		];
		const store = storeWith(new Set(["user-entry", "other-user"]));
		const issuer = createPairReceiptIssuer(store, entries);

		const first = issuer({
			kind: "user",
			sourceEntryId: "user-entry",
			snapshot: {
				text: "User message\n\nsee these\n\nand this\n\n2 images follow in original order.",
				images: [png, jpeg],
			},
		});
		const again = issuer({
			kind: "user",
			sourceEntryId: "user-entry",
			snapshot: { text: "ignored", images: [jpeg] },
		});
		expect(first).toMatch(/^[0-9a-f]{32}$/);
		expect(again).toBe(first);
		expect(issuer({ kind: "user", sourceEntryId: "missing-user", snapshot: { text: "no" } })).toBeUndefined();

		const before = await expand(store, first!);
		expect(textOf(before)).toBe(RECEIPT_UNAVAILABLE_TEXT);
		present(store, first!);
		const result = await expand(store, first!);
		const page = pageBody(result, ["user-entry"]);
		expect(page.body).toContain("User message");
		expect(page.body).toContain("see these");
		expect(page.body).toContain("2 images follow in original order.");
		expect(result.content.filter((part) => part.type === "image").map((part) => part.data)).toEqual([
			"USER_IMG_A",
			"USER_IMG_B",
		]);
		expect(result.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });
		expect(result.content[2]).toMatchObject({ type: "image", mimeType: "image/jpeg" });
	});

	it("projects user images as placeholders and a standalone receipt, never base64", async () => {
		const secret = "BASE64_SHOULD_NOT_APPEAR_IN_TRAJECTORY";
		const content = [
			{ type: "text" as const, text: "look" },
			{ type: "image" as const, data: secret, mimeType: "image/png" },
		];
		const imageOnly = [{ type: "image" as const, data: secret, mimeType: "image/webp" }];
		const entries = [
			{
				type: "message" as const,
				id: "u-mixed",
				parentId: "root",
				timestamp: "2026-01-01T00:00:00.000Z",
				message: { role: "user" as const, content, timestamp: 1 },
			},
			{
				type: "message" as const,
				id: "u-image",
				parentId: "u-mixed",
				timestamp: "2026-01-01T00:00:01.000Z",
				message: { role: "user" as const, content: imageOnly, timestamp: 2 },
			},
		];
		const store = storeWith(new Set(["u-mixed", "u-image"]));
		const issuer = createPairReceiptIssuer(store, entries);

		const mixed = formatUserMessage(content, { issueReceipt: issuer, sourceEntryId: "u-mixed" });
		const only = formatUserMessage(imageOnly, { issueReceipt: issuer, sourceEntryId: "u-image" });
		expect(mixed).toBe(`look\n[image]\nreceipt: ${mixed.match(/receipt: ([0-9a-f]{32})/)?.[1]}`);
		expect(only).toMatch(/^\[image]\nreceipt: [0-9a-f]{32}$/);
		expect(mixed).not.toContain(secret);
		expect(only).not.toContain(secret);
		expect(formatUserMessage("just text", { issueReceipt: issuer, sourceEntryId: "u-mixed" })).toBe("just text");

		const active = formatActiveSessionContext(entries as SessionEntry[], issuer);
		const sourced = formatSourceAddressedTrajectory(entries, ["u-mixed", "u-image"], issuer);
		const seeded = buildPairSeed({ entries, issueReceipt: issuer });
		for (const rendered of [active, sourced, seeded]) {
			expect(rendered).toContain("look\n[image]");
			expect(rendered).toMatch(/\[image]\nreceipt: [0-9a-f]{32}/);
			expect(rendered).not.toContain(secret);
			expect(rendered).toMatch(/receipt: [0-9a-f]{32}/);
		}

		const requests = collectRecentUserRequests(entries);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.prior).toBe(false);
		expect(requests[0]?.messages.map((message) => message.sourceEntryId)).toEqual(["u-mixed", "u-image"]);
		expect(requests[0]?.messages.map((message) => message.content)).toEqual([content, imageOnly]);

		store.activatePresented(active);
		const mixedHandle = mixed.match(/receipt: ([0-9a-f]{32})/)?.[1];
		const onlyHandle = only.match(/receipt: ([0-9a-f]{32})/)?.[1];
		expect(pageBody(await expand(store, mixedHandle!), ["u-mixed"]).body).toContain(
			"1 image follows in original order.",
		);
		const onlyResult = await expand(store, onlyHandle!);
		expect(onlyResult.content.some((part) => part.type === "image" && part.data === secret)).toBe(true);
		expect(pageBody(onlyResult, ["u-image"]).body).toContain("User message");
	});
});
