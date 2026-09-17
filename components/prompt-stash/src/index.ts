import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { inChildSessionContext } from "../../subagents/src/child-context.js";
import { openInExternalEditor } from "./external-editor.js";
import { DEFAULT_STASH_CAPACITY, PromptStash } from "./stash.js";

export { DEFAULT_STASH_CAPACITY, PromptStash } from "./stash.js";
export { openInExternalEditor, resolveEditorCommand } from "./external-editor.js";

function formatStashSnippet(text: string, maxLength = 60): string {
	const firstLine = text.split(/\r?\n/)[0]?.trim() || "";
	const snippet = firstLine.length > maxLength ? `${firstLine.slice(0, maxLength - 3)}...` : firstLine;
	const lineCount = text.split(/\r?\n/).length;
	const meta = lineCount > 1 ? `${lineCount} lines, ${text.length} chars` : `${text.length} chars`;
	return `${snippet} (${meta})`;
}

export async function showStashPicker(stash: PromptStash, ctx: ExtensionContext): Promise<void> {
	if (stash.isEmpty()) {
		ctx.ui.notify("Stash is empty.", "info");
		return;
	}

	const items = stash.list();
	const options: string[] = [];
	const originalIndices: number[] = [];

	// Present newest first (item at end of stack is index 1)
	for (let i = items.length - 1; i >= 0; i--) {
		const item = items[i];
		if (!item) continue;
		const displayNum = items.length - i;
		options.push(`[${displayNum}] ${formatStashSnippet(item.text)}`);
		originalIndices.push(i);
	}

	const selected = await ctx.ui.select("Prompt Stash (select to restore and pop)", options);
	if (!selected) return;

	const selectedIdx = options.indexOf(selected);
	if (selectedIdx === -1) return;

	const originalIndex = originalIndices[selectedIdx];
	const restored = stash.drop(originalIndex);
	if (restored !== undefined) {
		ctx.ui.setEditorText(restored);
		ctx.ui.notify(`Restored prompt from stash (${stash.size()}/${stash.getCapacity()} remaining).`, "info");
	}
}

export async function handleExternalEditor(ctx: ExtensionContext): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("External editor requires interactive TUI mode.", "warning");
		return;
	}

	const currentText = ctx.ui.getEditorText();
	let updatedContent: string | undefined;

	await ctx.ui.custom<void>(
		async (tui, _theme, _keybindings, done) => {
			try {
				const result = await openInExternalEditor({
					content: currentText,
					tui,
				});

				if (result.status === "saved" && result.content !== undefined) {
					updatedContent = result.content;
				} else if (result.status === "aborted") {
					ctx.ui.notify("External editor closed without saving.", "info");
				} else if (result.status === "error") {
					ctx.ui.notify(result.error ?? "Failed to run external editor.", "error");
				}
			} catch (err) {
				ctx.ui.notify(`External editor error: ${err instanceof Error ? err.message : String(err)}`, "error");
			} finally {
				done();
			}
			return new Container();
		},
		{ overlay: true },
	);

	if (updatedContent !== undefined) {
		ctx.ui.setEditorText(updatedContent);
		ctx.ui.notify("Prompt updated from external editor.", "info");
	}
}

export function handleStashPush(stash: PromptStash, ctx: ExtensionContext, explicitText?: string): void {
	const text = explicitText ?? ctx.ui.getEditorText();
	if (!text?.trim()) {
		ctx.ui.notify("No prompt to stash.", "info");
		return;
	}

	const result = stash.push(text);
	if (!result) {
		ctx.ui.notify("No prompt to stash.", "info");
		return;
	}

	if (!explicitText) {
		ctx.ui.setEditorText("");
	}

	if (result.evicted !== undefined) {
		ctx.ui.notify(`Prompt stashed (${result.size}/${stash.getCapacity()}, oldest evicted).`, "info");
	} else {
		ctx.ui.notify(`Prompt stashed (${result.size}/${stash.getCapacity()}).`, "info");
	}
}

export function handleStashPop(stash: PromptStash, ctx: ExtensionContext): void {
	if (stash.isEmpty()) {
		ctx.ui.notify("Stash is empty.", "warning");
		return;
	}

	const popped = stash.pop();
	if (popped !== undefined) {
		ctx.ui.setEditorText(popped);
		ctx.ui.notify(`Popped prompt from stash (${stash.size()}/${stash.getCapacity()} remaining).`, "info");
	}
}

export default function installPromptStash(pi: ExtensionAPI): void {
	if (inChildSessionContext()) return;

	const stash = new PromptStash(DEFAULT_STASH_CAPACITY);

	// Shortcuts for stashing the current prompt
	pi.registerShortcut("ctrl+s", {
		description: "Stash the current editor prompt",
		handler: (ctx) => handleStashPush(stash, ctx),
	});
	pi.registerShortcut("alt+s", {
		description: "Stash the current editor prompt",
		handler: (ctx) => handleStashPush(stash, ctx),
	});

	// Shortcuts for popping the top stashed prompt
	pi.registerShortcut("ctrl+shift+s", {
		description: "Pop the most recent prompt from stash into the editor",
		handler: (ctx) => handleStashPop(stash, ctx),
	});
	pi.registerShortcut("alt+shift+s", {
		description: "Pop the most recent prompt from stash into the editor",
		handler: (ctx) => handleStashPop(stash, ctx),
	});

	// Shortcut for pulling up the stash picker
	pi.registerShortcut("ctrl+alt+s", {
		description: "Open the prompt stash picker",
		handler: (ctx) => showStashPicker(stash, ctx),
	});

	// Shortcuts for opening the current prompt in $EDITOR
	pi.registerShortcut("ctrl+e", {
		description: "Open current prompt in external editor ($EDITOR)",
		handler: (ctx) => handleExternalEditor(ctx),
	});
	pi.registerShortcut("alt+e", {
		description: "Open current prompt in external editor ($EDITOR)",
		handler: (ctx) => handleExternalEditor(ctx),
	});

	// Command: /stash
	pi.registerCommand("stash", {
		description: "Manage stashed editor prompts (list, pop, drop, clear, push)",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const [subcommand, ...rest] = trimmed.split(/\s+/);
			const restArgs = rest.join(" ").trim();

			if (!subcommand || subcommand === "list") {
				await showStashPicker(stash, ctx);
				return;
			}

			if (subcommand === "pop") {
				handleStashPop(stash, ctx);
				return;
			}

			if (subcommand === "clear") {
				stash.clear();
				ctx.ui.notify("Stash cleared.", "info");
				return;
			}

			if (subcommand === "drop") {
				if (stash.isEmpty()) {
					ctx.ui.notify("Stash is empty.", "warning");
					return;
				}
				let targetIdx = stash.size() - 1;
				if (restArgs) {
					const parsed = Number.parseInt(restArgs, 10);
					if (Number.isNaN(parsed) || parsed < 1 || parsed > stash.size()) {
						ctx.ui.notify(`Invalid index: "${restArgs}". Valid indices are 1 to ${stash.size()}.`, "error");
						return;
					}
					// 1 is the most recent (top of stack)
					targetIdx = stash.size() - parsed;
				}
				const dropped = stash.drop(targetIdx);
				if (dropped !== undefined) {
					ctx.ui.notify(`Dropped prompt from stash (${stash.size()}/${stash.getCapacity()} remaining).`, "info");
				}
				return;
			}

			if (subcommand === "push") {
				handleStashPush(stash, ctx, restArgs || undefined);
				return;
			}

			if (subcommand === "help") {
				ctx.ui.notify(
					"Usage:\n  /stash            Open stash picker\n  /stash pop        Pop top prompt into editor\n  /stash list       Open stash picker\n  /stash drop [N]   Drop top prompt (or prompt #N)\n  /stash clear      Clear all stashed prompts\n  /stash push [txt] Stash prompt",
					"info",
				);
				return;
			}

			ctx.ui.notify(`Unknown stash subcommand: "${subcommand}". Use /stash help for usage.`, "error");
		},
	});

	// Command: /edit-prompt
	pi.registerCommand("edit-prompt", {
		description: "Open the current editor prompt in external editor ($EDITOR)",
		handler: async (_args, ctx) => {
			await handleExternalEditor(ctx);
		},
	});
}
