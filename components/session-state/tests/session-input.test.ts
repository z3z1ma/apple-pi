import { expect, test } from "vitest";
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
		await close(worker);
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
