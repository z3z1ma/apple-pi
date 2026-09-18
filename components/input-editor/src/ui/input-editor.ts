import {
	type ExtensionContext,
	type KeybindingsManager,
	CustomEditor as PiCustomEditor,
	type ReadonlyFooterDataProvider,
	type Theme,
	type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import {
	type EditorTheme,
	stripTerminalSequences,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { EmptyFooterFactory, FooterSnapshot } from "../types.js";

const FAST_MODE_STATUS = "fast-mode";
const VROOM_PROVIDERS = new Set(["openai-codex", "xai"]);
const RAIL_GLYPH = "│";
const RAIL_WIDTH = 2;

interface NativeEditorSplit {
	prompt: string[];
	autocomplete: string[];
	viewport?: {
		above?: string;
		below?: string;
	};
}

function safeRead<T>(read: () => T): T | undefined {
	try {
		return read();
	} catch {
		return undefined;
	}
}

function cleanOneLine(value: string): string {
	return value
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

export function sanitizeStatusText(text: string): string {
	return cleanOneLine(text);
}

/** ANSI-aware truncation used for every segment and card row. */
export function fitToWidth(text: string, width: number, omission = "…"): string {
	if (width <= 0) return "";
	if (visibleWidth(text) <= width) return text;
	if (visibleWidth(omission) >= width) return truncateToWidth(text, width, "");
	return truncateToWidth(text, width, omission);
}

function fillLine(content: string, width: number): string {
	const truncated = truncateToWidth(content, Math.max(0, width), "");
	const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
	return `${truncated}${pad}`;
}

function thinkingColor(level: string): ThemeColor {
	switch (level) {
		case "off":
			return "thinkingOff";
		case "minimal":
			return "thinkingMinimal";
		case "low":
			return "thinkingLow";
		case "medium":
			return "thinkingMedium";
		case "high":
			return "thinkingHigh";
		case "xhigh":
			return "thinkingXhigh";
		case "max":
			return "thinkingMax";
		default:
			return "thinkingText";
	}
}

function modelMetadata(snapshot: FooterSnapshot, theme: Theme): string | undefined {
	if (!snapshot.model) return undefined;
	const modelName = snapshot.model.name || snapshot.model.id;
	if (!modelName) return undefined;
	const provider = cleanOneLine(snapshot.model.providerName ?? snapshot.model.provider);
	const model = cleanOneLine(modelName);
	if (!provider || !model) return undefined;
	const thinking = snapshot.model.reasoning ? snapshot.model.thinkingLevel || "off" : undefined;
	const fast = snapshot.fastModeEnabled && VROOM_PROVIDERS.has(snapshot.model.provider) ? " ⚡" : "";

	const modelPart = theme.bold(theme.fg("syntaxType", model));
	const providerPart = theme.fg("muted", provider);

	let thinkingPart = "";
	if (thinking && thinking.toLowerCase() !== "off") {
		thinkingPart = theme.fg(thinkingColor(thinking), `${thinking}${fast}`);
	} else if (fast) {
		thinkingPart = theme.fg("muted", fast.trim());
	}

	const parts = [modelPart, providerPart, thinkingPart].filter(Boolean);
	return parts.join("  ");
}

function compactEditorStatus(snapshot: FooterSnapshot, width: number): string | undefined {
	const parts: string[] = [];
	const pairReviewing = snapshot.statuses.some(
		(status) => status.key === "q-pair" && /\breviewing\b/i.test(stripTerminalSequences(status.text)),
	);
	if (pairReviewing) parts.push("pair");

	const mcpStatus = snapshot.statuses.find((status) => status.key === "mcp");
	if (mcpStatus) {
		const text = stripTerminalSequences(mcpStatus.text);
		const count =
			text.match(/\bmcp:\s*(\d+)\b/i)?.[1] ??
			text.match(/\bMCP\s+\d+\s*\/\s*(\d+)\b/i)?.[1] ??
			text.match(/\b(\d+)\s+servers?\b/i)?.[1] ??
			text.match(/(\d+)\s*(?:\/\d+\s*)?server/i)?.[1];
		if (count && Number(count) > 0) parts.push(`mcp:${count}`);
	}

	if (snapshot.context) {
		const percent = snapshot.context.percent;
		parts.push(`ctx ${percent === null ? "?" : `${percent.toFixed(1)}%`}`);
	}

	if (parts.length === 0) return undefined;

	while (parts.length > 1 && visibleWidth(parts.join(" · ")) > width) {
		parts.shift();
	}
	return fitToWidth(parts.join(" · "), width, "");
}

function renderMetadataRow(snapshot: FooterSnapshot, theme: Theme, width: number): string | undefined {
	const metadata = modelMetadata(snapshot, theme);
	const metadataWidth = metadata ? visibleWidth(metadata) : 0;
	const minStatusWidth = snapshot.context ? visibleWidth(`ctx ${snapshot.context.percent?.toFixed(1) ?? "?"}%`) : 0;
	const statusBudget = metadata ? Math.max(minStatusWidth, width - metadataWidth - 1) : width;
	const statusText = compactEditorStatus(snapshot, statusBudget);
	const status = statusText ? theme.fg("muted", statusText) : undefined;
	if (!metadata && !status) return undefined;
	if (!status) return fitToWidth(metadata ?? "", width);
	if (!metadata) return `${" ".repeat(Math.max(0, width - visibleWidth(status)))}${status}`;

	const statusWidth = visibleWidth(status);
	const availableForMetadata = Math.max(0, width - statusWidth - 1);
	const fittedMetadata = fitToWidth(metadata, availableForMetadata, "");
	const padding = Math.max(1, width - visibleWidth(fittedMetadata) - statusWidth);
	return `${fittedMetadata}${" ".repeat(padding)}${status}`;
}

function renderEditorBorder(width: number, direction: "above" | "below", count?: string): string {
	if (!count || width <= 0) return "─".repeat(Math.max(0, width));
	const label = ` ${direction === "above" ? "↑" : "↓"} ${count} more `;
	if (visibleWidth(label) >= width) return "─".repeat(Math.max(0, width));
	const remaining = width - visibleWidth(label);
	const left = Math.floor(remaining / 2);
	const right = remaining - left;
	return `${"─".repeat(left)}${label}${"─".repeat(right)}`;
}

function parseViewportCount(line: string): string | undefined {
	const plain = stripTerminalSequences(line);
	const match = plain.match(/[↑↓] (\d+) more/);
	return match ? match[1] : undefined;
}

function editorRail(theme: Theme, isShellMode = false): string {
	const color = isShellMode ? "bashMode" : "accent";
	return `${theme.fg(color, RAIL_GLYPH)} `;
}

/**
 * Render the information zones around native editor content. `editorLines`
 * contains only the prompt rows; autocomplete is appended after this function returns.
 */
export function renderInputCard(
	snapshot: FooterSnapshot,
	theme: Theme,
	width: number,
	editorLines: readonly string[] = [""],
	viewport?: { above?: string; below?: string },
): string[] {
	if (width <= 0) return [];
	if (width <= 2) return editorLines.map((line) => truncateToWidth(line, width, ""));

	const prompt = editorLines.length > 0 ? editorLines : [""];
	const innerWidth = Math.max(0, width - RAIL_WIDTH);
	const isShellMode = (prompt[0] ?? "").trimStart().startsWith("!");
	const rail = editorRail(theme, isShellMode);

	const rows: string[] = [];

	// Show top border only when there is scrolled-off content above the viewport.
	if (viewport?.above) {
		rows.push(fitToWidth(theme.fg("dim", renderEditorBorder(width, "above", viewport.above)), width));
	}

	// Top padding line
	rows.push(`${rail}${" ".repeat(innerWidth)}`);

	// Prompt lines
	for (const line of prompt) {
		rows.push(`${rail}${fillLine(line, innerWidth)}`);
	}

	// Model metadata line with breathing gap
	const metadata = renderMetadataRow(snapshot, theme, innerWidth);
	if (metadata) {
		rows.push(`${rail}${" ".repeat(innerWidth)}`);
		rows.push(`${rail}${fillLine(metadata, innerWidth)}`);
	}

	// Show bottom border only when there is scrolled-off content below the viewport.
	if (viewport?.below) {
		rows.push(fitToWidth(theme.fg("dim", renderEditorBorder(width, "below", viewport.below)), width));
	}

	return rows.filter((row) => visibleWidth(row) <= width);
}

function isNativeEditorBorder(line: string): boolean {
	const plain = stripTerminalSequences(line);
	return /^[─.]+(?: [↑↓] \d+ more [─.]*)?$/.test(plain);
}

function splitNativeEditorLines(lines: readonly string[]): NativeEditorSplit {
	if (lines.length === 0) return { prompt: [""], autocomplete: [] };
	if (lines.length === 1) return { prompt: [...lines], autocomplete: [] };
	if (lines.length === 2) return { prompt: [""], autocomplete: [] };
	let bottom = -1;
	for (let index = lines.length - 1; index > 0; index--) {
		if (isNativeEditorBorder(lines[index]!)) {
			bottom = index;
			break;
		}
	}
	if (bottom <= 0) bottom = lines.length - 1;
	const prompt = lines.slice(1, bottom);
	const topCount = parseViewportCount(lines[0] ?? "");
	const bottomCount = bottom < lines.length ? parseViewportCount(lines[bottom] ?? "") : undefined;
	return {
		prompt: prompt.length > 0 ? prompt : [""],
		autocomplete: lines.slice(bottom + 1),
		viewport: topCount || bottomCount ? { above: topCount, below: bottomCount } : undefined,
	};
}

export function collectInputCardSnapshot(
	ctx: ExtensionContext,
	footerData?: ReadonlyFooterDataProvider,
): FooterSnapshot {
	const model = safeRead(() => ctx.model);
	const modelProvider = model && typeof model.provider === "string" && model.provider ? model.provider : undefined;
	const providerName = modelProvider
		? safeRead(() => ctx.modelRegistry.getProviderDisplayName(modelProvider))
		: undefined;
	const thinkingLevel = safeRead(() => ctx.thinkingLevel);
	const contextUsage = safeRead(() => ctx.getContextUsage());
	const statusMap = safeRead(() => footerData?.getExtensionStatuses());
	const statuses = statusMap
		? [...statusMap.entries()].flatMap(([key, text]) =>
				typeof key === "string" && typeof text === "string" ? [{ key, text }] : [],
			)
		: [];

	const context =
		contextUsage !== undefined
			? {
					percent:
						contextUsage.percent === null ||
						(typeof contextUsage.percent === "number" && Number.isFinite(contextUsage.percent))
							? contextUsage.percent
							: null,
				}
			: undefined;

	return {
		model:
			model && typeof model.id === "string" && model.id && modelProvider
				? {
						provider: modelProvider,
						providerName: typeof providerName === "string" && providerName ? providerName : undefined,
						id: model.id,
						name: typeof model.name === "string" && model.name ? model.name : undefined,
						reasoning: model.reasoning === true,
						thinkingLevel: typeof thinkingLevel === "string" ? thinkingLevel : undefined,
					}
				: undefined,
		context,
		fastModeEnabled:
			modelProvider !== undefined && VROOM_PROVIDERS.has(modelProvider) && statusMap?.has(FAST_MODE_STATUS) === true,
		statuses,
	};
}

/** Collapse the dock footer entry's minSize from 1 to 0 in fullscreen viewport dock. */
export function collapseDockFooter(tui: unknown): void {
	try {
		const root = (tui as any)?.layoutRoot;
		if (!root || !Array.isArray(root.entries)) return;
		for (const rootEntry of root.entries) {
			const candidate = rootEntry?.component;
			if (candidate && Array.isArray(candidate.entries)) {
				for (const entry of candidate.entries) {
					if (entry && entry.minSize === 1) {
						entry.minSize = 0;
					}
				}
			}
		}
	} catch {
		// Fall open safely if runtime layout shape differs
	}
}

/** Custom editor that preserves Pi's complete native editor behavior. */
export class InputCardEditor extends PiCustomEditor {
	#disposed = false;
	#unsubscribeBranch: (() => void) | undefined;

	constructor(
		private readonly ctx: ExtensionContext,
		private readonly tuiForCard: TUI,
		editorTheme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly footerData: ReadonlyFooterDataProvider | undefined,
		private readonly cardTheme: Theme,
	) {
		super(tuiForCard, editorTheme, keybindings, { paddingX: 0 });
		collapseDockFooter(tuiForCard);
		this.#unsubscribeBranch = footerData?.onBranchChange(() => {
			if (this.#disposed) return;
			try {
				tuiForCard.requestRender();
			} catch {
				this.dispose();
			}
		});
	}

	handleInput(data: string): void {
		super.handleInput(data);
	}

	render(width: number): string[] {
		if (this.#disposed || width <= 0) return [];
		collapseDockFooter(this.tuiForCard);
		if (width <= 2) {
			return super.render(width).map((line) => truncateToWidth(line, width, ""));
		}
		const innerWidth = Math.max(0, width - RAIL_WIDTH);
		const nativeLines = super.render(innerWidth);
		const split = splitNativeEditorLines(nativeLines);
		const snapshot = collectInputCardSnapshot(this.ctx, this.footerData);
		const theme = safeRead(() => this.ctx.ui.theme) ?? this.cardTheme;
		const card = renderInputCard(snapshot, theme, width, split.prompt, split.viewport);
		const autocomplete = split.autocomplete.map((line) => fitToWidth(line, width, ""));
		return [...card, ...autocomplete].filter((line) => visibleWidth(line) <= width);
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		try {
			this.#unsubscribeBranch?.();
		} finally {
			this.#unsubscribeBranch = undefined;
		}
	}
}

export function createInputCardEditorFactory(
	ctx: ExtensionContext,
	footerData?: ReadonlyFooterDataProvider,
): (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => InputCardEditor {
	return (tui, theme, keybindings) => {
		collapseDockFooter(tui);
		return new InputCardEditor(ctx, tui, theme, keybindings, footerData, ctx.ui.theme);
	};
}

export const renderCard = renderInputCard;
export const collectFooterSnapshot = collectInputCardSnapshot;
export const renderStatusFooter = renderInputCard;
export const renderFooter = renderInputCard;
export type InputCardEditorFactory = ReturnType<typeof createInputCardEditorFactory>;
export type InputCardFactory = EmptyFooterFactory;
