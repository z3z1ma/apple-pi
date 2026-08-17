import { describe, expect, it } from "vitest";
import { ProgressChannel, SnapshotProjection } from "../src/progress-channel.js";

describe("ProgressChannel", () => {
	it("replays, clones, isolates listener errors, and unsubscribes idempotently", () => {
		const channel = new ProgressChannel<{ runId: string; sequence: number; value: number }>();
		expect(channel.nextSequence("a")).toBe(1);
		channel.publish({ runId: "a", sequence: 1, value: 1 });
		const seen: number[] = [];
		const unsub = channel.subscribe((snapshot) => {
			seen.push(snapshot.value);
			snapshot.value = 99;
			if (seen.length === 2) throw new Error("listener boom");
		});
		expect(seen).toEqual([1]);
		expect(channel.current("a")?.value).toBe(1);
		channel.publish({ runId: "a", sequence: 2, value: 2 });
		expect(seen).toEqual([1, 2]);
		expect(channel.current("a")?.value).toBe(2);
		unsub();
		unsub();
		channel.publish({ runId: "a", sequence: 3, value: 3 });
		expect(seen).toEqual([1, 2]);
	});
});

describe("SnapshotProjection", () => {
	it("rejects identity mutation and sequence regression", () => {
		const projection = new SnapshotProjection<{ runId: string; sequence: number; root: string }>(
			(s) => `${s.runId}:${s.root}`,
		);
		expect(projection.apply({ runId: "r", sequence: 1, root: "/a" }).ok).toBe(true);
		expect(projection.apply({ runId: "r", sequence: 1, root: "/a" }).ok).toBe(false);
		expect(projection.apply({ runId: "r", sequence: 2, root: "/b" }).ok).toBe(false);
		expect(projection.apply({ runId: "r", sequence: 2, root: "/a" }).ok).toBe(true);
	});
});
