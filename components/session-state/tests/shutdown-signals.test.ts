import { EventEmitter } from "node:events";
import { expect, test } from "vitest";
import { observeShutdownSignals } from "../src/shutdown-signals.js";

test("known listener order distinguishes in-process disposal from either signal", async () => {
	for (const signal of [undefined, "SIGTERM", "SIGHUP"]) {
		const host = new EventEmitter();
		const observation = observeShutdownSignals(host);
		let deliberate: boolean | undefined;
		const dispose = () => {
			deliberate = observation.deliberate();
		};
		host.prependListener("SIGTERM", dispose);
		host.prependListener("SIGHUP", dispose);
		await Promise.resolve();
		if (signal) host.emit(signal);
		else {
			host.off("SIGTERM", dispose);
			host.off("SIGHUP", dispose);
			dispose();
		}
		expect(deliberate).toBe(signal === undefined);
		observation.dispose();
		expect(host.listeners("newListener")).toHaveLength(0);
	}
});

test("missing host handlers or an unobserved prepend stays conservative", async () => {
	const host = new EventEmitter();
	const observation = observeShutdownSignals(host);
	expect(observation.deliberate()).toBe(false);
	host.prependListener("SIGTERM", () => expect(observation.deliberate()).toBe(false));
	host.emit("SIGTERM");
	await Promise.resolve();
	expect(observation.deliberate()).toBe(false);
	observation.dispose();
});
