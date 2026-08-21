import type { ExtensionContext, ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import type { InteractiveModeConstructor, StatusFooterFactory } from "../src/index.js";
import { installForTui } from "../src/index.js";

const theme = { fg: (_color: string, text: string) => text } as unknown as Theme;
const footerData = {
	getGitBranch: () => "main",
	getExtensionStatuses: () => new Map<string, string>(),
	getAvailableProviderCount: () => 1,
	onBranchChange: () => () => {},
};

function validSession() {
	return {
		sessionManager: { getEntries: () => [] },
		modelRuntime: { isUsingSubscription: () => false },
		autoCompactionEnabled: true,
	};
}

class FakeInteractiveMode {
	readonly calls: unknown[] = [];
	#footer: (Component & { dispose?(): void }) | undefined;

	constructor(
		readonly session: unknown,
		private readonly data = footerData,
	) {}

	setExtensionFooter(factory: unknown): unknown {
		this.calls.push(factory);
		this.#footer?.dispose?.();
		this.#footer = factory ? (factory as StatusFooterFactory)({} as TUI, theme, this.data) : undefined;
		return this.#footer;
	}
}

function contextFor(
	instance: FakeInteractiveMode,
	existingEditor: unknown = undefined,
): ExtensionContext & {
	footerCalls: unknown[];
	editorCalls: unknown[];
	notifications: string[];
} {
	const footerCalls: unknown[] = [];
	const editorCalls: unknown[] = [];
	const notifications: string[] = [];
	const ui = {
		theme,
		getEditorComponent: () => existingEditor,
		setEditorComponent: (factory: unknown) => {
			editorCalls.push(factory);
			if (typeof factory === "function") {
				factory(
					{ terminal: { rows: 24 }, requestRender: () => {} } as TUI,
					{ borderColor: (text: string) => text, selectList: {} },
					{},
				);
			}
		},
		setFooter: (factory: unknown) => {
			footerCalls.push(factory);
			instance.setExtensionFooter(factory);
		},
		notify: (message: string) => notifications.push(message),
	} as unknown as ExtensionUIContext;
	const ctx = {
		ui,
		mode: "tui",
		cwd: "/tmp/project",
		sessionManager: {
			getCwd: () => "/tmp/project",
			getSessionName: () => undefined,
		},
		model: undefined,
		getContextUsage: () => undefined,
	} as unknown as ExtensionContext;
	Object.assign(ctx, { footerCalls, editorCalls, notifications });
	return ctx as ExtensionContext & {
		footerCalls: unknown[];
		editorCalls: unknown[];
		notifications: string[];
	};
}

describe("input card installation", () => {
	it("does not install any TUI surface in RPC mode", () => {
		const instance = new FakeInteractiveMode(validSession());
		const ctx = contextFor(instance);
		ctx.mode = "rpc";
		installForTui(ctx, { interactiveMode: FakeInteractiveMode as unknown as InteractiveModeConstructor });

		expect(ctx.footerCalls).toEqual([]);
		expect(ctx.editorCalls).toEqual([]);
		expect(instance.calls).toEqual([]);
	});

	it("captures before installing the empty footer and then installs the editor", () => {
		const instance = new FakeInteractiveMode(validSession());
		const modeConstructor = FakeInteractiveMode as unknown as InteractiveModeConstructor;
		const ctx = contextFor(instance);
		installForTui(ctx, { interactiveMode: modeConstructor });

		expect(ctx.footerCalls).toHaveLength(1);
		expect(ctx.editorCalls).toHaveLength(1);
		expect(instance.calls).toHaveLength(1);
		expect(modeConstructor.prototype.setExtensionFooter).toBe(FakeInteractiveMode.prototype.setExtensionFooter);
		expect(ctx.notifications).toEqual([]);
	});

	it("disposes the paired card editor when Pi replaces its footer", () => {
		let unsubscribeCount = 0;
		const data = {
			...footerData,
			onBranchChange: () => () => {
				unsubscribeCount++;
			},
		};
		const instance = new FakeInteractiveMode(validSession(), data);
		const ctx = contextFor(instance);
		installForTui(ctx, { interactiveMode: FakeInteractiveMode as unknown as InteractiveModeConstructor });

		instance.setExtensionFooter(undefined);
		expect(unsubscribeCount).toBe(1);
	});

	it("does not replace an existing custom editor", () => {
		const instance = new FakeInteractiveMode(validSession());
		const ctx = contextFor(instance, () => ({}) as Component);
		installForTui(ctx, { interactiveMode: FakeInteractiveMode as unknown as InteractiveModeConstructor });

		expect(ctx.footerCalls).toEqual([]);
		expect(ctx.editorCalls).toEqual([]);
		expect(ctx.notifications[0]).toContain("another custom editor");
	});

	it("leaves both surfaces untouched when telemetry capture fails", () => {
		const instance = new FakeInteractiveMode({ sessionManager: {} });
		const ctx = contextFor(instance);
		installForTui(ctx, { interactiveMode: FakeInteractiveMode as unknown as InteractiveModeConstructor });

		expect(ctx.editorCalls).toEqual([]);
		expect(instance.calls).toEqual([]);
		expect(ctx.notifications[0]).toContain("telemetry");
	});

	it("restores built-in surfaces when card construction fails", () => {
		function onBranchChange(): () => void {
			throw new Error("branch subscription failed");
		}
		const throwingData = { ...footerData, onBranchChange };
		const instance = new FakeInteractiveMode(validSession(), throwingData);
		const modeConstructor = FakeInteractiveMode as unknown as InteractiveModeConstructor;
		const ctx = contextFor(instance);
		installForTui(ctx, { interactiveMode: modeConstructor });

		expect(ctx.editorCalls).toHaveLength(2);
		expect(ctx.editorCalls[1]).toBeUndefined();
		expect(ctx.footerCalls.at(-1)).toBeUndefined();
		expect(instance.calls.at(-1)).toBeUndefined();
		expect(ctx.notifications[0]).toContain("built-in footer");
	});
});
