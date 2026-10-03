import { describe, expect, it, vi } from "vitest";
import { AgentManager } from "../src/agent-manager.js";
import { disposeAgentSession } from "../src/session-lifecycle.js";
import type { AgentRecord } from "../src/types.js";

describe("child session disposal", () => {
	it("notifies extensions before invalidating their session", async () => {
		const order: string[] = [];
		const session = {
			extensionRunner: {
				emit: vi.fn(async (event) => {
					expect(event).toEqual({ type: "session_shutdown", reason: "quit" });
					order.push("shutdown");
				}),
			},
			dispose: vi.fn(() => order.push("dispose")),
		};

		await disposeAgentSession(session as any);

		expect(order).toEqual(["shutdown", "dispose"]);
	});

	it("contains shutdown and disposal failures", async () => {
		const dispose = vi.fn(() => {
			throw new Error("dispose failed");
		});
		await expect(
			disposeAgentSession({
				extensionRunner: {
					emit: vi.fn(async () => {
						throw new Error("shutdown failed");
					}),
				},
				dispose,
			} as any),
		).resolves.toBeUndefined();
		expect(dispose).toHaveBeenCalledOnce();
	});

	it("keeps finished public agents until session end while expiring finished nested agents", () => {
		vi.useFakeTimers();
		try {
			const manager = new AgentManager();
			const finished = (id: string, overrides: Partial<AgentRecord>) =>
				({
					id,
					type: "explorer",
					description: id,
					status: "completed",
					toolUses: 0,
					startedAt: Date.now(),
					completedAt: Date.now(),
					lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
					compactionCount: 0,
					resultConsumed: true,
					session: { extensionRunner: { emit: vi.fn(async () => {}) }, dispose: vi.fn() },
					...overrides,
				}) as unknown as AgentRecord;
			(manager as any).agents.set("public", finished("public", {}));
			(manager as any).agents.set("nested", finished("nested", { parentAgentId: "public" }));

			vi.advanceTimersByTime(11 * 60_000);

			expect(manager.getRecord("public")).toBeDefined();
			expect(manager.getRecord("nested")).toBeUndefined();

			// A new session keeps an unread public result only for the usual 10 minutes.
			(manager as any).agents.set("unread", finished("unread", { resultConsumed: false }));
			manager.clearCompleted(true);
			expect(manager.getRecord("public")).toBeUndefined();
			expect(manager.getRecord("unread")).toBeDefined();
			vi.advanceTimersByTime(11 * 60_000);
			expect(manager.getRecord("unread")).toBeUndefined();
			manager.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("requires the internal owner capability to steer, resume, or discard a hidden session", async () => {
		const owner = "apple-pi:btw";
		const steer = vi.fn(async () => {});
		const dispose = vi.fn();
		const manager = new AgentManager();
		const record = {
			id: "owned",
			type: "BTW",
			description: "hidden",
			status: "running",
			toolUses: 0,
			startedAt: Date.now(),
			lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
			compactionCount: 0,
			internalOwner: owner,
			session: {
				steer,
				extensionRunner: { emit: vi.fn(async () => {}) },
				dispose,
			},
		} as unknown as AgentRecord;
		(manager as any).agents.set(record.id, record);

		expect(manager.steer(record.id, "public")).toBe(false);
		expect(await manager.resume(record.id, "public")).toBeUndefined();
		expect(manager.discardInternal(record.id, "wrong-owner")).toBe(false);
		expect(manager.steer(record.id, "private", owner)).toBe(true);
		expect(steer).toHaveBeenCalledWith("private");
		expect(manager.discardInternal(record.id, owner)).toBe(true);
		expect(manager.getRecord(record.id)).toBeUndefined();
		await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
		manager.dispose();
	});
});
