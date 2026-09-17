import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { runInChildSessionContext } from "../../subagents/src/child-context.js";
import installPromptStash, {
	handleExternalEditor,
	handleStashPop,
	handleStashPush,
	PromptStash,
	showStashPicker,
} from "../src/index.js";

type ShortcutOptions = Parameters<ExtensionAPI["registerShortcut"]>[1];
type CommandOptions = Parameters<ExtensionAPI["registerCommand"]>[1];

function createMockExtensionAPI() {
	const shortcuts = new Map<string, ShortcutOptions>();
	const commands = new Map<string, CommandOptions>();

	const pi = {
		registerShortcut: (key: string, options: ShortcutOptions) => {
			shortcuts.set(key, options);
		},
		registerCommand: (name: string, options: CommandOptions) => {
			commands.set(name, options);
		},
	} as unknown as ExtensionAPI;

	return { pi, shortcuts, commands };
}

function createMockContext(options?: { editorText?: string; mode?: "tui" | "rpc"; selectChoice?: string }) {
	let currentEditorText = options?.editorText ?? "";
	const notifications: Array<{ message: string; type: string }> = [];

	const ctx = {
		mode: options?.mode ?? "tui",
		ui: {
			getEditorText: () => currentEditorText,
			setEditorText: (text: string) => {
				currentEditorText = text;
			},
			notify: (message: string, type = "info") => {
				notifications.push({ message, type });
			},
			select: vi.fn().mockImplementation(async () => options?.selectChoice),
			custom: vi.fn().mockImplementation(async (fn) => {
				await fn({ stop: vi.fn(), start: vi.fn(), requestRender: vi.fn() }, {}, {}, vi.fn());
			}),
		},
	} as unknown as ExtensionCommandContext;

	return {
		ctx,
		notifications,
		getEditorText: () => currentEditorText,
	};
}

describe("prompt stash installer", () => {
	it("skips registration when inside child session context", () => {
		const { pi, shortcuts, commands } = createMockExtensionAPI();
		runInChildSessionContext(() => {
			installPromptStash(pi);
		});

		expect(shortcuts.size).toBe(0);
		expect(commands.size).toBe(0);
	});

	it("registers all expected shortcuts and commands in root session", () => {
		const { pi, shortcuts, commands } = createMockExtensionAPI();
		installPromptStash(pi);

		expect(shortcuts.has("ctrl+s")).toBe(true);
		expect(shortcuts.has("alt+s")).toBe(true);
		expect(shortcuts.has("ctrl+shift+s")).toBe(true);
		expect(shortcuts.has("alt+shift+s")).toBe(true);
		expect(shortcuts.has("ctrl+alt+s")).toBe(true);
		expect(shortcuts.has("ctrl+e")).toBe(true);
		expect(shortcuts.has("alt+e")).toBe(true);

		expect(commands.has("stash")).toBe(true);
		expect(commands.has("edit-prompt")).toBe(true);
	});
});

describe("prompt stash operations", () => {
	it("pushes text from editor and clears editor", () => {
		const stash = new PromptStash(5);
		const { ctx, notifications, getEditorText } = createMockContext({
			editorText: "Refactor database migrations",
		});

		handleStashPush(stash, ctx);

		expect(stash.size()).toBe(1);
		expect(stash.peek()).toBe("Refactor database migrations");
		expect(getEditorText()).toBe("");
		expect(notifications).toEqual([{ message: "Prompt stashed (1/5).", type: "info" }]);
	});

	it("pushes explicit text without clearing editor", () => {
		const stash = new PromptStash(5);
		const { ctx, notifications, getEditorText } = createMockContext({
			editorText: "Keep this in editor",
		});

		handleStashPush(stash, ctx, "Explicit stash text");

		expect(stash.size()).toBe(1);
		expect(stash.peek()).toBe("Explicit stash text");
		expect(getEditorText()).toBe("Keep this in editor");
		expect(notifications[0]?.message).toBe("Prompt stashed (1/5).");
	});

	it("ignores empty text on push", () => {
		const stash = new PromptStash(5);
		const { ctx, notifications } = createMockContext({ editorText: "   " });

		handleStashPush(stash, ctx);
		expect(stash.size()).toBe(0);
		expect(notifications[0]?.message).toBe("No prompt to stash.");
	});

	it("notifies when push evicts oldest prompt", () => {
		const stash = new PromptStash(2);
		stash.push("one");
		stash.push("two");

		const { ctx, notifications } = createMockContext({
			editorText: "three",
		});
		handleStashPush(stash, ctx);

		expect(stash.size()).toBe(2);
		expect(notifications[0]?.message).toBe("Prompt stashed (2/2, oldest evicted).");
	});

	it("pops top prompt into editor", () => {
		const stash = new PromptStash(5);
		stash.push("Saved prompt");

		const { ctx, notifications, getEditorText } = createMockContext();
		handleStashPop(stash, ctx);

		expect(stash.isEmpty()).toBe(true);
		expect(getEditorText()).toBe("Saved prompt");
		expect(notifications[0]?.message).toContain("Popped prompt from stash");
	});

	it("notifies when popping from empty stash", () => {
		const stash = new PromptStash(5);
		const { ctx, notifications } = createMockContext();
		handleStashPop(stash, ctx);

		expect(notifications[0]?.message).toBe("Stash is empty.");
	});
});

describe("stash picker", () => {
	it("notifies if stash is empty", async () => {
		const stash = new PromptStash(5);
		const { ctx, notifications } = createMockContext();

		await showStashPicker(stash, ctx);
		expect(notifications[0]?.message).toBe("Stash is empty.");
	});

	it("restores selected prompt and removes it from stash", async () => {
		const stash = new PromptStash(5);
		stash.push("Oldest task");
		stash.push("Newest task");

		// List options are formatted newest-first:
		// [1] Newest task (11 chars)
		// [2] Oldest task (11 chars)
		const { ctx, notifications, getEditorText } = createMockContext({
			selectChoice: "[2] Oldest task (11 chars)",
		});

		await showStashPicker(stash, ctx);

		expect(getEditorText()).toBe("Oldest task");
		expect(stash.size()).toBe(1);
		expect(stash.peek()).toBe("Newest task");
		expect(notifications[0]?.message).toContain("Restored prompt from stash");
	});

	it("does nothing if user cancels picker", async () => {
		const stash = new PromptStash(5);
		stash.push("Some prompt");

		const { ctx, getEditorText } = createMockContext({
			selectChoice: undefined,
		});

		await showStashPicker(stash, ctx);
		expect(stash.size()).toBe(1);
		expect(getEditorText()).toBe("");
	});
});

describe("external editor handler", () => {
	it("warns when not in TUI mode", async () => {
		const { ctx, notifications } = createMockContext({ mode: "rpc" });
		await handleExternalEditor(ctx);

		expect(notifications[0]?.message).toContain("requires interactive TUI mode");
	});
});

describe("/stash command", () => {
	it("executes subcommands correctly", async () => {
		const { pi, commands } = createMockExtensionAPI();
		installPromptStash(pi);

		const stashCommand = commands.get("stash");
		expect(stashCommand).toBeDefined();

		const { ctx, notifications, getEditorText } = createMockContext();

		// /stash push
		await stashCommand?.handler("push prompt alpha", ctx);
		expect(notifications.at(-1)?.message).toContain("Prompt stashed");

		// /stash push second
		await stashCommand?.handler("push prompt beta", ctx);
		expect(notifications.at(-1)?.message).toContain("Prompt stashed");

		// /stash pop
		await stashCommand?.handler("pop", ctx);
		expect(getEditorText()).toBe("prompt beta");

		// /stash drop
		await stashCommand?.handler("drop", ctx);
		expect(notifications.at(-1)?.message).toContain("Dropped prompt from stash");

		// /stash drop on empty
		await stashCommand?.handler("drop", ctx);
		expect(notifications.at(-1)?.message).toContain("Stash is empty");

		// /stash clear
		await stashCommand?.handler("push test", ctx);
		await stashCommand?.handler("clear", ctx);
		expect(notifications.at(-1)?.message).toContain("Stash cleared");

		// /stash help
		await stashCommand?.handler("help", ctx);
		expect(notifications.at(-1)?.message).toContain("Usage:");

		// /stash unknown
		await stashCommand?.handler("xyz", ctx);
		expect(notifications.at(-1)?.message).toContain("Unknown stash subcommand");
	});
});
