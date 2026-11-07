import type { EventEmitter } from "node:events";

export function observeShutdownSignals(target: EventEmitter) {
	const signals = ["SIGTERM", "SIGHUP"];
	let active = true;
	let signalled = false;
	let ordered = false;
	const mark = () => {
		signalled = true;
	};
	const order = () => {
		if (!active) return;
		for (const signal of signals) {
			if (!target.rawListeners(signal).some((listener) => listener !== mark)) continue;
			target.off(signal, mark);
			target.prependListener(signal, mark);
		}
		ordered = signals.every((signal) => target.rawListeners(signal)[0] === mark);
	};
	const added = (event: string | symbol, listener: (...args: unknown[]) => void) => {
		if (typeof event !== "string" || !signals.includes(event) || listener === mark) return;
		ordered = false;
		queueMicrotask(order);
	};
	target.on("newListener", added);
	order();
	return {
		deliberate: () =>
			active && ordered && !signalled && signals.every((signal) => target.rawListeners(signal)[0] === mark),
		dispose() {
			active = false;
			target.off("newListener", added);
			for (const signal of signals) target.off(signal, mark);
		},
	};
}
