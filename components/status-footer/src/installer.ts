import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import { installFooterWithTelemetryBridge } from "./bridge.js";
import type { InteractiveModeConstructor, StatusFooterFactory, TelemetrySession } from "./types.js";
import { createInputCardEditorFactory, type InputCardEditor } from "./ui/input-card.js";

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
	onData: (data: Parameters<StatusFooterFactory>[2]) => void,
	onDispose: () => void,
): StatusFooterFactory {
	return (_tui, _theme, footerData) => {
		onData(footerData);
		return new EmptyFooter(onDispose);
	};
}

function notifyUnavailable(ctx: ExtensionContext, message: string, error?: unknown): void {
	const errorDetail = error instanceof Error && error.message ? `: ${error.message}` : "";
	ctx.ui.notify(
		`Apple Pi input card unavailable; keeping the current editor/footer (${message}${errorDetail}).`,
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

/**
 * Install the empty footer and card editor only after the private telemetry
 * bridge has captured the active Pi session. Pi exposes no transaction for the
 * two surfaces, so a later editor-construction failure restores the built-in
 * editor/footer rather than attempting unsupported composition.
 */
export interface InputCardInstallOptions {
	interactiveMode?: InteractiveModeConstructor;
}

export function installForTui(ctx: ExtensionContext, options: InputCardInstallOptions = {}): void {
	if (ctx.mode !== "tui") return;
	const editorBoundary = getEditorBoundary(ctx);
	if (editorBoundary) {
		notifyUnavailable(ctx, editorBoundary);
		return;
	}

	let capturedSession: TelemetrySession | undefined;
	let capturedFooterData: Parameters<StatusFooterFactory>[2] | undefined;
	let activeEditor: InputCardEditor | undefined;
	const emptyFooterFactory = createEmptyFooterFactory(
		(footerData) => {
			capturedFooterData = footerData;
		},
		() => {
			activeEditor?.dispose();
			activeEditor = undefined;
		},
	);

	const result = installFooterWithTelemetryBridge({
		interactiveMode: options.interactiveMode,
		setFooter: (requestedFactory) => ctx.ui.setFooter(requestedFactory),
		factory: emptyFooterFactory,
		onCapture: (session) => {
			capturedSession = session;
		},
	});

	if (!result.installed || !capturedSession || !capturedFooterData) {
		const reason = result.reason ?? "the telemetry session was not captured";
		notifyUnavailable(ctx, reason, result.error);
		return;
	}

	const editorFactory = createInputCardEditorFactory(ctx, capturedSession, capturedFooterData);
	try {
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = editorFactory(tui, theme, keybindings);
			activeEditor = editor as InputCardEditor;
			return editor;
		});
	} catch (error) {
		activeEditor?.dispose();
		try {
			ctx.ui.setEditorComponent(undefined);
		} catch {
			// Keep the original construction failure as the visible diagnostic.
		}
		try {
			ctx.ui.setFooter(undefined);
		} catch {
			// Pi's public API does not provide another recovery path.
		}
		notifyUnavailable(
			ctx,
			"card construction failed; restored Pi's built-in footer (an earlier custom footer cannot be recovered)",
			error,
		);
	}
}

/** Register the TUI-only Apple Pi input card without changing RPC UI state. */
export default function installStatusFooter(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		try {
			installForTui(ctx);
		} catch (error) {
			notifyUnavailable(ctx, "installation failed", error);
		}
	});
}

export { EmptyFooter };
