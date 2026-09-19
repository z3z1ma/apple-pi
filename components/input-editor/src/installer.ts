import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import type { EmptyFooterFactory } from "./types.js";
import {
	type CacheHitRateTracker,
	cacheHitTrackerFromHistory,
	createInputCardEditorFactory,
	type InputCardEditor,
} from "./ui/input-editor.js";

const TRACK_WIDTH = 5;
const BOUNCE_FRAMES_COUNT = (TRACK_WIDTH - 1) * 2;

function buildBouncingBallFrames(accentFn: (text: string) => string, mutedFn: (text: string) => string): string[] {
	const frames: string[] = [];
	for (let i = 0; i < BOUNCE_FRAMES_COUNT; i++) {
		const pos = i < TRACK_WIDTH ? i : BOUNCE_FRAMES_COUNT - i;
		const inner = `${" ".repeat(pos)}●${" ".repeat(TRACK_WIDTH - 1 - pos)}`;
		const left = mutedFn("(");
		const ball = accentFn(inner);
		const right = mutedFn(")");
		frames.push(`${left}${ball}${right}`);
	}
	return frames;
}

class EmptyFooter implements Component {
	constructor(private readonly onDispose?: () => void) {}

	invalidate(): void {}

	render(): string[] {
		return [];
	}

	dispose(): void {
		this.onDispose?.();
	}
}

function createEmptyFooterFactory(
	onData: (data: Parameters<EmptyFooterFactory>[2]) => void,
	onDispose: () => void,
): EmptyFooterFactory {
	return (_tui, _theme, footerData) => {
		onData(footerData);
		return new EmptyFooter(onDispose);
	};
}

function notifyUnavailable(ctx: ExtensionContext, message: string, error?: unknown): void {
	const errorDetail = error instanceof Error && error.message ? `: ${error.message}` : "";
	ctx.ui.notify(
		`Apple Pi input editor unavailable; keeping the current editor/footer (${message}${errorDetail}).`,
		"warning",
	);
}

function getEditorBoundary(ctx: ExtensionContext): string | undefined {
	if (typeof ctx.ui.getEditorComponent !== "function" || typeof ctx.ui.setEditorComponent !== "function") {
		return "Pi's custom-editor API is unavailable";
	}
	let existing: unknown;
	try {
		existing = ctx.ui.getEditorComponent();
	} catch {
		return "Pi's current custom editor could not be inspected";
	}
	if (existing !== undefined) return "another custom editor already owns the prompt";
	return undefined;
}

function restoreBuiltInSurfaces(ctx: ExtensionContext): void {
	try {
		ctx.ui.setEditorComponent(undefined);
	} catch {
		// Continue restoring the footer even if the editor API is unavailable.
	}
	try {
		ctx.ui.setFooter(undefined);
	} catch {
		// Pi provides no additional recovery path.
	}
}

/** Install the TUI-only input editor through Pi's public editor and footer APIs. */
export function installForTui(ctx: ExtensionContext, cacheHitTracker?: CacheHitRateTracker): void {
	if (ctx.mode !== "tui") return;
	cacheHitTracker ??= cacheHitTrackerFromHistory(ctx);
	const editorBoundary = getEditorBoundary(ctx);
	if (editorBoundary) {
		notifyUnavailable(ctx, editorBoundary);
		return;
	}

	let footerData: Parameters<EmptyFooterFactory>[2] | undefined;
	let activeEditor: InputCardEditor | undefined;
	const emptyFooterFactory = createEmptyFooterFactory(
		(data) => {
			footerData = data;
		},
		() => {
			activeEditor?.dispose();
			activeEditor = undefined;
		},
	);

	try {
		ctx.ui.setFooter(emptyFooterFactory);
	} catch (error) {
		notifyUnavailable(ctx, "footer installation failed", error);
		return;
	}
	if (!footerData) {
		restoreBuiltInSurfaces(ctx);
		notifyUnavailable(ctx, "Pi did not synchronously provide footer status data");
		return;
	}

	const editorFactory = createInputCardEditorFactory(ctx, footerData, cacheHitTracker);
	try {
		ctx.ui.setWorkingIndicator({
			frames: buildBouncingBallFrames(
				(text) => ctx.ui.theme.fg("accent", text),
				(text) => ctx.ui.theme.fg("muted", text),
			),
			intervalMs: 100,
		});
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			activeEditor?.dispose();
			activeEditor = editorFactory(tui, theme, keybindings);
			return activeEditor;
		});
	} catch (error) {
		activeEditor?.dispose();
		activeEditor = undefined;
		restoreBuiltInSurfaces(ctx);
		notifyUnavailable(
			ctx,
			"card construction failed; restored Pi's built-in footer (an earlier custom footer cannot be recovered)",
			error,
		);
	}
}

/** Register the TUI-only Apple Pi input editor without changing RPC UI state. */
export default function installInputEditor(pi: ExtensionAPI): void {
	let cacheHitTracker: CacheHitRateTracker | undefined;

	pi.on("session_start", (_event, ctx) => {
		cacheHitTracker = undefined;
		if (ctx.mode !== "tui") return;
		try {
			cacheHitTracker = cacheHitTrackerFromHistory(ctx);
			installForTui(ctx, cacheHitTracker);
		} catch (error) {
			notifyUnavailable(ctx, "installation failed", error);
		}
	});

	pi.on("message_end", (event, ctx) => {
		if (ctx.mode === "tui") cacheHitTracker?.observeMessage(event.message);
	});

	pi.on("session_compact", (event, ctx) => {
		if (ctx.mode === "tui") cacheHitTracker?.observeEntry(event.compactionEntry);
	});

	pi.on("session_tree", (event, ctx) => {
		if (ctx.mode === "tui" && event.summaryEntry) cacheHitTracker?.observeEntry(event.summaryEntry);
	});

	pi.on("session_shutdown", () => {
		cacheHitTracker = undefined;
	});
}

export { EmptyFooter };
