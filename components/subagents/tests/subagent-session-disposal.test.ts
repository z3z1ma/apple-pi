import { describe, expect, it, vi } from "vitest";
import { disposeAgentSession } from "../src/agent-manager.js";

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
});
