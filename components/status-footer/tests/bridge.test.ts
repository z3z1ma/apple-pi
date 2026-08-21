import type { Component } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import type { InteractiveModeConstructor, StatusFooterFactory } from "../src/index.js";
import { installFooterWithTelemetryBridge } from "../src/index.js";

function validSession() {
	return {
		sessionManager: { getEntries: () => [] },
		modelRuntime: { isUsingSubscription: () => false },
		autoCompactionEnabled: true,
	};
}

function factoryThatReturns(component: Component): StatusFooterFactory {
	return () => component;
}

class FakeInteractiveMode {
	readonly calls: unknown[] = [];
	factoryInvocations = 0;

	constructor(readonly session: unknown) {}

	setExtensionFooter(factory: unknown): unknown {
		this.calls.push(factory);
		if (!factory) return undefined;
		this.factoryInvocations++;
		return (factory as StatusFooterFactory)({} as never, {} as never, {} as never);
	}
}

describe("Pi private footer telemetry bridge", () => {
	it("captures only the exact factory and restores the prototype immediately", () => {
		const instance = new FakeInteractiveMode(validSession());
		const modeConstructor = FakeInteractiveMode as unknown as InteractiveModeConstructor;
		const original = modeConstructor.prototype.setExtensionFooter;
		const component = { render: () => [], invalidate: () => {} } as Component;
		const factory = factoryThatReturns(component);
		let captured = false;
		const result = installFooterWithTelemetryBridge({
			interactiveMode: modeConstructor,
			factory,
			setFooter: (requested) => {
				instance.setExtensionFooter(() => component);
				instance.setExtensionFooter(requested);
			},
			onCapture: () => {
				captured = true;
			},
		});

		expect(result.installed).toBe(true);
		expect(captured).toBe(true);
		expect(instance.calls).toHaveLength(2);
		expect(instance.factoryInvocations).toBe(2);
		expect(modeConstructor.prototype.setExtensionFooter).toBe(original);
	});

	it("does not invoke the custom factory when capture is unavailable", () => {
		const instance = new FakeInteractiveMode({ sessionManager: {} });
		const modeConstructor = FakeInteractiveMode as unknown as InteractiveModeConstructor;
		const component = { render: () => [], invalidate: () => {} } as Component;
		const factory = factoryThatReturns(component);
		const result = installFooterWithTelemetryBridge({
			interactiveMode: modeConstructor,
			factory,
			setFooter: (requested) => instance.setExtensionFooter(requested),
		});

		expect(result.installed).toBe(false);
		expect(instance.calls).toEqual([]);
		expect(instance.factoryInvocations).toBe(0);
		expect(modeConstructor.prototype.setExtensionFooter).toBe(FakeInteractiveMode.prototype.setExtensionFooter);
	});

	it("restores the native footer when custom construction throws", () => {
		const instance = new FakeInteractiveMode(validSession());
		const modeConstructor = FakeInteractiveMode as unknown as InteractiveModeConstructor;
		const factory = (() => {
			throw new Error("factory failed");
		}) as unknown as StatusFooterFactory;
		const result = installFooterWithTelemetryBridge({
			interactiveMode: modeConstructor,
			factory,
			setFooter: (requested) => instance.setExtensionFooter(requested),
		});

		expect(result.installed).toBe(false);
		expect(result.error).toBeInstanceOf(Error);
		expect(instance.calls).toEqual([factory, undefined]);
		expect(modeConstructor.prototype.setExtensionFooter).toBe(FakeInteractiveMode.prototype.setExtensionFooter);
	});
});
