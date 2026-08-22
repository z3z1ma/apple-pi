import { describe, expect, it, vi } from "vitest";
import { AgentManager, disposeAgentSession } from "../src/agent-manager.js";
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
