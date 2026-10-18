import { afterAll, beforeAll, expect, test } from "vitest";
import { query, sendCommand, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();

beforeAll(() => startRuntime(state.socketPath));
afterAll(() => stopRuntime(state));

test("set_preference stores a choice as JSON, replaces it on the next set, and records each set", async () => {
	expect(
		await sendCommand(state.socketPath, "notch", { kind: "set_preference", key: "notch", value: { vibes: { a: 1 } } }),
	).toEqual([{ stage: "accepted" }, { stage: "applied" }]);
	expect(
		await sendCommand(state.socketPath, "notch", { kind: "set_preference", key: "notch", value: { vibes: { a: 2 } } }),
	).toEqual([{ stage: "accepted" }, { stage: "applied" }]);

	const rows = query<{ key: string; value: string }>(state.dbPath, "select key, value from preferences");
	expect(rows.map((row) => ({ key: row.key, value: JSON.parse(row.value) }))).toEqual([
		{ key: "notch", value: { vibes: { a: 2 } } },
	]);
	expect(query(state.dbPath, "select count(*) as n from events where type = 'preference_set'")).toEqual([{ n: 2 }]);
});

test("set_preference without a key fails and stores nothing", async () => {
	const receipts = await sendCommand(state.socketPath, "notch", { kind: "set_preference", key: "", value: 1 });
	expect(receipts.at(-1)?.stage).toBe("failed");
	expect(query(state.dbPath, "select key from preferences where key = ''")).toEqual([]);
});
