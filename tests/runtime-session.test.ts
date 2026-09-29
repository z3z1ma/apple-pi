import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import runtime from "../extensions/runtime.js";
import { sealCheckpoint } from "../extensions/runtime-checkpoint.js";
import { isOwnedMontyWorker } from "../extensions/runtime-implementation.js";

function harness(manager: SessionManager) {
	const tools = new Map<string, any>();
	const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
	const ctx = { cwd: process.cwd(), sessionManager: manager, hasUI: false, isProjectTrusted: () => false };
	runtime({
		registerTool(tool: any) {
			tools.set(tool.name, tool);
		},
		appendEntry(type: string, data: unknown) {
			manager.appendCustomEntry(type, data);
		},
		on(event: string, handler: (event: any, ctx: any) => unknown) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
	} as any);
	return {
		ctx,
		tool: tools.get("pi_exec"),
		async emit(event: string, data: any = {}) {
			for (const handler of handlers.get(event) ?? []) await handler(data, ctx);
		},
		async run(id: string, code: string, reset = false) {
			return tools.get("pi_exec").execute(id, { code, ...(reset ? { reset: true } : {}) }, undefined, undefined, ctx);
		},
	};
}

describe("pi_exec Monty session tree", () => {
	it("persists globals and functions across calls and extension reload", async () => {
		const manager = SessionManager.inMemory(process.cwd());
		const first = harness(manager);
		await first.emit("session_start", { reason: "startup" });
		try {
			await first.run("assign", "x = 1\ndef increment():\n    return 1");
			expect((await first.run("reuse", "x + increment()")).content[0].text).toBe("2");
			await first.emit("session_shutdown", { reason: "reload" });
			const reloaded = harness(manager);
			await reloaded.emit("session_start", { reason: "reload" });
			try {
				expect((await reloaded.run("resume", "x + increment()")).content[0].text).toBe("2");
			} finally {
				await reloaded.emit("session_shutdown", { reason: "quit" });
			}
		} finally {
			await first.emit("session_shutdown", { reason: "quit" });
		}
	});

	it("authenticates persisted checkpoints after reopening the Pi session file", async () => {
		const directory = mkdtempSync(join(tmpdir(), "apple-pi-monty-checkpoint-"));
		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = join(directory, "agent");
		try {
			const manager = SessionManager.create(process.cwd(), join(directory, "sessions"));
			const first = harness(manager);
			await first.emit("session_start", { reason: "startup" });
			manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Running pi_exec" }] } as never);
			await first.run("set", "x = 1");
			await first.emit("session_shutdown", { reason: "quit" });
			const reopened = harness(SessionManager.open(manager.getSessionFile()!));
			await reopened.emit("session_start", { reason: "resume" });
			try {
				expect((await reopened.run("get", "x + 1")).content[0].text).toBe("2");
			} finally {
				await reopened.emit("session_shutdown", { reason: "quit" });
			}
			if (process.platform !== "win32")
				expect(statSync(join(directory, "agent", "monty-checkpoint.key")).mode & 0o077).toBe(0);
		} finally {
			if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("restores the nearest branch checkpoint and places reset before its feed", async () => {
		const manager = SessionManager.inMemory(process.cwd());
		const session = harness(manager);
		await session.emit("session_start", { reason: "startup" });
		try {
			await session.run("first", "x: int = 1");
			const firstCheckpoint = manager.getLeafId()!;
			await session.run("second", "x = 2");
			manager.branch(firstCheckpoint);
			await session.emit("session_tree", { reason: "navigate" });
			expect((await session.run("branch", "x")).content[0].text).toBe("1");
			await session.run("reset", "y = 3", true);
			expect((await session.run("fresh", "y")).content[0].text).toBe("3");
			await expect(session.run("forgotten", "x")).rejects.toThrow(/not defined/);
		} finally {
			await session.emit("session_shutdown", { reason: "quit" });
		}
	});

	it("saves ordinary Python errors but rolls back terminal failures to the previous checkpoint", async () => {
		const manager = SessionManager.inMemory(process.cwd());
		const session = harness(manager);
		await session.emit("session_start", { reason: "startup" });
		try {
			await session.run("first", "x: int = 1");
			await expect(session.run("exception", "x = 2\n1 / 0")).rejects.toThrow(/division by zero/);
			expect((await session.run("after-error", "x")).content[0].text).toBe("2");
			await expect(
				session.tool.execute(
					"timeout",
					{ code: "x = 3\nwhile True:\n    pass", limits: { timeoutSeconds: 1 } },
					undefined,
					undefined,
					session.ctx,
				),
			).rejects.toThrow(/timed out.*rolled back/s);
			expect((await session.run("after-timeout", "x")).content[0].text).toBe("2");
		} finally {
			await session.emit("session_shutdown", { reason: "quit" });
		}
	});

	it("rolls back after exceeding Monty's memory limit", async () => {
		const manager = SessionManager.inMemory(process.cwd());
		const session = harness(manager);
		await session.emit("session_start", { reason: "startup" });
		try {
			await session.run("first", "x: int = 1");
			await expect(session.run("memory", 'data = "x" * 140_000_000')).rejects.toThrow(/rolled back/);
			expect((await session.run("after-memory", "x")).content[0].text).toBe("1");
		} finally {
			await session.emit("session_shutdown", { reason: "quit" });
		}
	});

	it("rejects an altered dump before loading it and reports the empty interpreter", async () => {
		const manager = SessionManager.inMemory(process.cwd());
		const session = harness(manager);
		await session.emit("session_start", { reason: "startup" });
		try {
			await session.run("first", "x = 1");
			const entry = manager.getLeafEntry();
			if (entry?.type !== "custom") throw new Error("Expected a Monty checkpoint");
			manager.appendCustomEntry("apple-pi:monty-session", { ...(entry.data as object), dump: "broken" });
			await session.emit("session_tree", { reason: "navigate" });
			expect((await session.run("recover", "1")).content[0].text).toMatch(
				/Notice: Monty checkpoint is incompatible or unverifiable.*\n\n1/s,
			);
			await expect(session.run("forgotten", "x")).rejects.toThrow(/not defined/);
		} finally {
			await session.emit("session_shutdown", { reason: "quit" });
		}
	});

	it("reports an authenticated dump that Monty can no longer load", async () => {
		const manager = SessionManager.inMemory(process.cwd());
		const session = harness(manager);
		await session.emit("session_start", { reason: "startup" });
		try {
			await session.run("first", "x = 1");
			const entry = manager.getLeafEntry();
			if (entry?.type !== "custom") throw new Error("Expected a Monty checkpoint");
			const stubsHash = (entry.data as { stubsHash: string }).stubsHash;
			manager.appendCustomEntry(
				"apple-pi:monty-session",
				await sealCheckpoint(manager, Buffer.from("broken"), stubsHash),
			);
			await session.emit("session_tree", { reason: "navigate" });
			expect((await session.run("recover", "1")).content[0].text).toMatch(
				/Notice: Monty checkpoint could not be loaded.*\n\n1/s,
			);
			await expect(session.run("forgotten", "x")).rejects.toThrow(/not defined/);
		} finally {
			await session.emit("session_shutdown", { reason: "quit" });
		}
	});

	it("reports an incompatible checkpoint and continues with a fresh interpreter", async () => {
		const manager = SessionManager.inMemory(process.cwd());
		const session = harness(manager);
		await session.emit("session_start", { reason: "startup" });
		try {
			await session.run("first", "x = 1");
			manager.appendCustomEntry("apple-pi:monty-session", { version: 1, dump: "broken", stubsHash: "old" });
			await session.emit("session_tree", { reason: "navigate" });
			const recovered = await session.run("recover", "1");
			expect(recovered.content[0].text).toMatch(/Notice: Monty checkpoint is incompatible.*\n\n1/s);
			await expect(session.run("forgotten", "x")).rejects.toThrow(/not defined/);
		} finally {
			await session.emit("session_shutdown", { reason: "quit" });
		}
	});

	it("strictly validates worker process ownership before any signal can be dispatched", async () => {
		expect(isOwnedMontyWorker(undefined)).toBe(false);
		expect(isOwnedMontyWorker(-1)).toBe(false);
		expect(isOwnedMontyWorker(0)).toBe(false);
		expect(isOwnedMontyWorker(1)).toBe(false); // PID 1 (init/launchd)
		expect(isOwnedMontyWorker(process.pid)).toBe(false); // Our own process (not a child subprocess)
		expect(isOwnedMontyWorker(999_999_999)).toBe(false); // Non-existent PID
	});
});
