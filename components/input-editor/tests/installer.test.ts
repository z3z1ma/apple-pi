import type {
	ExtensionContext,
	ExtensionUIContext,
	ReadonlyFooterDataProvider,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import type { EmptyFooterFactory } from "../src/index.js";
import { installForTui } from "../src/index.js";

const theme = { fg: (_color: string, text: string) => text } as unknown as Theme;
const footerData: ReadonlyFooterDataProvider = {
	getGitBranch: () => "main",
	getExtensionStatuses: () => new Map<string, string>(),
	getAvailableProviderCount: () => 1,
	onBranchChange: () => () => {},
};

function contextFor(
	options: { existingEditor?: unknown; provideFooterData?: boolean; throwWhenSettingEditor?: boolean } = {},
): ExtensionContext & {
	footerCalls: unknown[];
	editorCalls: unknown[];
	notifications: string[];
} {
	const footerCalls: unknown[] = [];
	const editorCalls: unknown[] = [];
	const notifications: string[] = [];
	let activeFooter: (Component & { dispose?(): void }) | undefined;
	const ui = {
		theme,
		getEditorComponent: () => options.existingEditor,
		setEditorComponent: (factory: unknown) => {
			editorCalls.push(factory);
			if (options.throwWhenSettingEditor && typeof factory === "function") {
				throw new Error("editor failed");
			}
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
			activeFooter?.dispose?.();
			activeFooter =
				typeof factory === "function" && options.provideFooterData !== false
					? (factory as EmptyFooterFactory)({} as TUI, theme, footerData)
					: undefined;
		},
		notify: (message: string) => notifications.push(message),
	} as unknown as ExtensionUIContext;
	const ctx = {
		ui,
		mode: "tui",
		cwd: "/tmp/project",
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

describe("input editor installation", () => {
	it("does not install in RPC mode", () => {
		const ctx = contextFor();
		ctx.mode = "rpc";
		installForTui(ctx);
		expect(ctx.footerCalls).toEqual([]);
		expect(ctx.editorCalls).toEqual([]);
	});

	it("installs empty footer and custom editor", () => {
		const ctx = contextFor();
		installForTui(ctx);
		expect(ctx.footerCalls).toHaveLength(1);
		expect(ctx.editorCalls).toHaveLength(1);
		expect(ctx.notifications).toEqual([]);
	});

	it("does not replace an existing custom editor", () => {
		const ctx = contextFor({ existingEditor: () => ({}) as Component });
		installForTui(ctx);
		expect(ctx.footerCalls).toEqual([]);
		expect(ctx.editorCalls).toEqual([]);
		expect(ctx.notifications[0]).toContain("another custom editor");
	});

	it("restores built-in surfaces when Pi does not provide footer status data", () => {
		const ctx = contextFor({ provideFooterData: false });
		installForTui(ctx);
		expect(ctx.editorCalls).toEqual([undefined]);
		expect(ctx.footerCalls.at(-1)).toBeUndefined();
		expect(ctx.notifications[0]).toContain("footer status data");
	});

	it("restores built-in surfaces when card construction fails", () => {
		const ctx = contextFor({ throwWhenSettingEditor: true });
		installForTui(ctx);
		expect(ctx.editorCalls).toHaveLength(2);
		expect(ctx.editorCalls.at(-1)).toBeUndefined();
		expect(ctx.footerCalls.at(-1)).toBeUndefined();
		expect(ctx.notifications[0]).toContain("built-in footer");
	});
});
