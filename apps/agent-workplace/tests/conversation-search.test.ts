import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { searchConversations } from "../src/backend/conversation-search.js";

test("DM search finds what the operator and agents said, never tool output or thoughts", async () => {
	const dir = mkdtempSync(join(tmpdir(), "aw-dm-search-"));
	const line = (id: string, at: string, message: unknown) =>
		JSON.stringify({ type: "message", id, parentId: null, timestamp: at, message });
	const ada = join(dir, "ada.jsonl");
	writeFileSync(
		ada,
		[
			line("u1", "2026-11-01T10:00:00.000Z", { role: "user", content: "Look at the flaky webhook test." }),
			line("a1", "2026-11-01T10:01:00.000Z", {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "the webhook secret is odd" },
					{ type: "text", text: "The Webhook retry was the cause." },
				],
			}),
			line("r1", "2026-11-01T10:02:00.000Z", {
				role: "toolResult",
				toolCallId: "c1",
				toolName: "bash",
				content: [{ type: "text", text: "webhook.ts:12" }],
			}),
		].join("\n"),
	);
	const db = join(dir, "state.db");
	const writer = new DatabaseSync(db);
	writer.exec("create table sessions (id text, session_file text, retired_at integer)");
	writer.prepare("insert into sessions values ('ada', ?, null), ('gone', ?, 1)").run(ada, ada);
	writer.close();

	const found = await searchConversations(db, "webhook", 10);
	expect(found).toEqual({
		ok: true,
		hits: [
			expect.objectContaining({
				session: "ada",
				entry: "a1",
				speaker: "ada",
				text: "The Webhook retry was the cause.",
			}),
			expect.objectContaining({ session: "ada", entry: "u1", speaker: "operator" }),
		],
	});
	expect(await searchConversations(db, "we", 10)).toEqual({ ok: true, hits: [] });
});
