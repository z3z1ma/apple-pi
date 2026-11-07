import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { sessionInput } from "../src/session-input.js";
import { close } from "./helpers.js";

test("the native input boundary counts an idle extension command and keeps its seal across reinstall", async () => {
	let release!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let entered = 0;
	const worker = await fauxSession(
		[
			(pi) => {
				pi.registerCommand("hold", {
					description: "Hold preparation",
					handler: async () => {
						entered++;
						await held;
					},
				});
			},
		],
		[],
		[],
	);
	try {
		const gate = sessionInput(worker.session);
		const preparing = worker.session.prompt("/hold");
		expect(worker.session.isIdle).toBe(true);
		expect(gate.seal("first")).toBe(false);
		release();
		await preparing;
		expect(entered).toBe(1);
		expect(gate.seal("first")).toBe(true);
		const reinstalled = sessionInput(worker.session);
		expect(reinstalled.seal("foreign-ticket")).toBe(false);
		reinstalled.release("stale");
		await expect(worker.session.prompt("/hold")).rejects.toThrow(/sealed/);
		await expect(worker.session.steer("new steer")).rejects.toThrow(/sealed/);
		await expect(worker.session.followUp("new follow-up")).rejects.toThrow(/sealed/);
		await expect(
			worker.session.sendCustomMessage(
				{ customType: "probe", content: "new input", display: false },
				{ triggerTurn: true },
			),
		).rejects.toThrow(/sealed/);
		await expect(worker.session.executeBash("exit 77")).rejects.toThrow(/sealed/);
		reinstalled.release("first");
		await worker.session.prompt("/hold");
		expect(entered).toBe(2);
		expect(worker.requests).toHaveLength(0);
	} finally {
		release();
		sessionInput(worker.session).release("first");
		sessionInput(worker.session).release("foreign-ticket");
		await close(worker);
	}
});

test.each(["tree", "compact"] as const)("round2: native %s entry respects a held seal", async (kind) => {
	let entered = 0;
	const worker = await fauxSession(
		[
			(pi) => {
				pi.on("session_before_tree", () => {
					entered++;
					return { cancel: true };
				});
				pi.on("session_before_compact", () => {
					entered++;
					return { cancel: true };
				});
			},
		],
		[],
		[],
	);
	vi.spyOn(worker.session.settingsManager, "getCompactionSettings").mockReturnValue({
		enabled: false,
		reserveTokens: 1,
		keepRecentTokens: 1,
	});
	const manager = worker.session.sessionManager;
	const target = manager.appendMessage({ role: "user", content: "seed", timestamp: Date.now() });
	manager.appendMessage(fauxAssistantMessage("seed response"));
	const gate = sessionInput(worker.session);
	try {
		expect(gate.seal("tree-seal")).toBe(true);
		const start = () =>
			kind === "tree" ? worker.session.navigateTree(target, { summarize: true }) : worker.session.compact();
		await expect(start()).rejects.toThrow(/sealed/);
		expect(entered).toBe(0);
		gate.release("tree-seal");
		if (kind === "tree") await start();
		else await expect(start()).rejects.toThrow("Compaction cancelled");
		expect(entered).toBe(1);
		expect(worker.requests).toHaveLength(0);
	} finally {
		gate.release("tree-seal");
		await close(worker);
	}
});

test.each(["tree", "compact"] as const)(
	"round2: native %s preparation blocks a replacement seal until settlement",
	async (kind) => {
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let entered = false;
		const worker = await fauxSession(
			[
				(pi) => {
					const hold = async () => {
						entered = true;
						await held;
						return { cancel: true as const };
					};
					pi.on("session_before_tree", hold);
					pi.on("session_before_compact", hold);
				},
			],
			[],
			[],
		);
		vi.spyOn(worker.session.settingsManager, "getCompactionSettings").mockReturnValue({
			enabled: false,
			reserveTokens: 1,
			keepRecentTokens: 1,
		});
		const manager = worker.session.sessionManager;
		const target = manager.appendMessage({ role: "user", content: "seed", timestamp: Date.now() });
		manager.appendMessage(fauxAssistantMessage("seed response"));
		sessionInput(worker.session);
		const pending = (
			kind === "tree" ? worker.session.navigateTree(target, { summarize: true }) : worker.session.compact()
		).catch((error: Error) => {
			expect(kind).toBe("compact");
			expect(error.message).toBe("Compaction cancelled");
		});
		const replacement = await fauxSession([], [], []);
		const gate = sessionInput(replacement.session);
		try {
			await vi.waitFor(() => expect(entered).toBe(true));
			expect(gate.seal("native-work")).toBe(false);
			release();
			await pending;
			expect(gate.seal("native-work")).toBe(true);
			expect(worker.requests).toHaveLength(0);
		} finally {
			release();
			await pending;
			gate.release("native-work");
			await close(worker);
			await close(replacement);
		}
	},
);

test("round2: legacy launch state cannot certify unknown earlier preparation", async () => {
	const key = Symbol.for("apple-pi.launch-input-seal");
	const host = process as NodeJS.Process & Record<symbol, unknown>;
	const previous = host[key];
	host[key] = {};
	const worker = await fauxSession(
		[
			(pi) => {
				pi.registerCommand("done", { description: "Handle input", handler: async () => {} });
			},
		],
		[],
		[],
	);
	try {
		const gate = sessionInput(worker.session);
		expect(gate.scope).toBeUndefined();
		expect(gate.seal("unknown-work")).toBe(false);
		await worker.session.prompt("/done");
		expect(gate.seal("unknown-work")).toBe(false);
		expect(worker.requests).toHaveLength(0);
	} finally {
		sessionInput(worker.session).release("unknown-work");
		await close(worker);
		host[key] = previous;
	}
});

test("round2: replacement waits for disposed native preparation in the same launch", async () => {
	let release!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let entered = false;
	const previous = await fauxSession(
		[
			(pi) => {
				pi.on("input", async () => {
					entered = true;
					await held;
					return { action: "handled" };
				});
			},
		],
		[],
		[],
	);
	const first = sessionInput(previous.session);
	const pending = previous.session.prompt("held input");
	const replacement = await fauxSession([], [], []);
	const next = sessionInput(replacement.session);
	try {
		expect(entered).toBe(true);
		expect(previous.session.isIdle).toBe(true);
		expect(first.seal("pending-seal")).toBe(false);
		await previous.session.abort();
		await previous.session.extensionRunner.emit({ type: "session_shutdown", reason: "resume" });
		previous.session.dispose();
		expect(next.seal("pending-seal")).toBe(false);
		release();
		await pending;
		expect(next.seal("pending-seal")).toBe(true);
		expect(previous.requests).toHaveLength(0);
	} finally {
		release();
		await pending;
		next.release("pending-seal");
		previous.dispose();
		await close(replacement);
	}
});

test("a new native session object in the same launch inherits a pending seal", async () => {
	const previous = await fauxSession([], [], []);
	let entered = 0;
	const replacement = await fauxSession(
		[
			(pi) => {
				pi.registerCommand("work", {
					description: "Observe accepted input",
					handler: async () => {
						entered++;
					},
				});
			},
		],
		[],
		[],
	);
	const first = sessionInput(previous.session);
	const next = sessionInput(replacement.session);
	try {
		expect(first.seal("replacement-seal")).toBe(true);
		await expect(replacement.session.prompt("/work")).rejects.toThrow(/sealed/);
		expect(entered).toBe(0);
		first.release("replacement-seal");
		await replacement.session.prompt("/work");
		expect(entered).toBe(1);
		expect(replacement.requests).toHaveLength(0);
	} finally {
		first.release("replacement-seal");
		next.release("replacement-seal");
		await close(previous);
		await close(replacement);
	}
});
