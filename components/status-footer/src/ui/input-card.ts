import { isAbsolute, relative, resolve, sep } from "node:path";
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
import type {
	FooterSnapshot,
	FooterStatus,
	FooterUsageTotals,
	StatusFooterFactory,
	TelemetrySession,
} from "../types.js";
import { collectUsageTotals } from "../usage.js";

const KNOWN_STATUS_ORDER = ["mcp-auth", "mcp", "backlog", "todos", "q-pair", "subagents"];
const FLEET_NAVIGATION_STATUS = "subagents-navigation";
const FAST_MODE_STATUS = "fast-mode";
const VROOM_PROVIDERS = new Set(["openai-codex", "xai"]);
const RAIL_GLYPH = "│";
const RAIL_WIDTH = 2;

interface RenderSegment {
	text: string;
	priority: 1 | 2 | 3;
	essential?: boolean;
}

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

export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

export function formatCwdForFooter(cwd: string, home = process.env.HOME || process.env.USERPROFILE): string {
	if (!home) return cwd;
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));
	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

/** ANSI-aware truncation used for every segment and card row. */
export function fitToWidth(text: string, width: number, omission = "…"): string {
	if (width <= 0) return "";
	if (visibleWidth(text) <= width) return text;
	if (visibleWidth(omission) >= width) return truncateToWidth(text, width, "");
	return truncateToWidth(text, width, omission);
}

function padToWidth(text: string, width: number): string {
	const fitted = fitToWidth(text, width, "");
	return `${fitted}${" ".repeat(Math.max(0, width - visibleWidth(fitted)))}`;
}

function statusRank(key: string): number {
	const index = KNOWN_STATUS_ORDER.indexOf(key);
	return index === -1 ? KNOWN_STATUS_ORDER.length : index;
}

function orderedStatuses(statuses: readonly FooterStatus[]): FooterStatus[] {
	return [...statuses].sort((left, right) => {
		const rankDifference = statusRank(left.key) - statusRank(right.key);
		return rankDifference || left.key.localeCompare(right.key);
	});
}

function contextColor(percent: number | null): "dim" | "error" | "muted" | "warning" {
	if (percent === null) return "muted";
	if (percent > 90) return "error";
	if (percent > 70) return "warning";
	return "dim";
}

/** Apply a foreground while restoring it after cursor or producer-owned ANSI resets. */
function fgPreservingNestedStyles(theme: Theme, color: Parameters<Theme["fg"]>[0], text: string): string {
	const styledEmpty = theme.fg(color, "");
	const styleStart = styledEmpty.replace(/\u001b\[(?:0|39)m/g, "");
	return theme.fg(
		color,
		text.replace(/\u001b\[(?:0|39)m/g, (reset) => `${reset}${styleStart}`),
	);
}

function statusColor(status: FooterStatus): ThemeColor {
	const text = stripTerminalSequences(status.text).toLowerCase();
	if (/\b(?:error|failed|failure)\b/.test(text)) return "error";
	if (status.key === "mcp-auth") return "warning";
	if (status.key === "mcp") return /\b(?:connecting|authenticating)\b/.test(text) ? "warning" : "dim";
	if (status.key === "q-pair") return text.includes("reviewing") ? "customMessageLabel" : "muted";
	if (status.key === "subagents") return /\b(?:queued|waiting|stopped)\b/.test(text) ? "warning" : "success";
	return "muted";
}

function formatCompactMcpStatus(text: string): string {
	const plain = stripTerminalSequences(text);
	const serverMatch = plain.match(/(\d+)\s*(?:\/\d+\s*)?server/i);
	if (serverMatch) return `mcp:${serverMatch[1]}`;
	const ratioMatch = plain.match(/MCP\s+(\d+\/\d+)/i);
	if (ratioMatch) return `mcp:${ratioMatch[1]}`;
	if (/\bconnecting\b/i.test(plain)) return "mcp…";
	if (/\bauthenticat/i.test(plain)) return "mcp:auth";
	if (/\b(?:error|fail)/i.test(plain)) return "mcp:err";
	return "mcp";
}

function styleStatus(status: FooterStatus, theme: Theme): string {
	const displayText =
		status.key === "mcp" || status.key === "mcp-auth"
			? formatCompactMcpStatus(status.text)
			: sanitizeStatusText(status.text);
	return fgPreservingNestedStyles(theme, statusColor(status), displayText);
}

function joinSegments(segments: readonly RenderSegment[], separator: string): string {
	return segments.map((segment) => segment.text).join(separator);
}

function requiredWidth(segments: readonly RenderSegment[], separator: string, marker = ""): number {
	return (
		segments.reduce((sum, segment) => sum + visibleWidth(segment.text), 0) +
		Math.max(0, segments.length - 1) * visibleWidth(separator) +
		visibleWidth(marker) +
		(marker ? visibleWidth(separator) : 0)
	);
}

function removeLowestPrioritySegment(segments: RenderSegment[]): boolean {
	const removable = segments
		.map((segment, index) => ({ segment, index }))
		.filter(({ segment }) => !segment.essential)
		.sort((left, right) => right.segment.priority - left.segment.priority || right.index - left.index)[0];
	if (!removable) return false;
	segments.splice(removable.index, 1);
	return true;
}

/**
 * Pack a semantic group into one bounded row. Whole low-priority segments are
 * removed before high-priority content is truncated, and removal is marked.
 */
function packSegments(segments: readonly RenderSegment[], width: number, separator: string, theme: Theme): string {
	if (width <= 0 || segments.length === 0) return "";

	const kept = segments.filter((segment) => visibleWidth(segment.text) > 0).map((segment) => ({ ...segment }));
	if (kept.length === 0) return "";

	let omitted = false;
	while (requiredWidth(kept, separator, omitted ? "…" : "") > width && removeLowestPrioritySegment(kept)) {
		omitted = true;
	}

	const mustMark = omitted || requiredWidth(kept, separator) > width;
	const marker = mustMark ? theme.fg("dim", "…") : "";
	const markerSeparator = marker && kept.length > 0 ? separator : "";
	const separatorWidth = Math.max(0, kept.length - 1) * visibleWidth(separator);
	const available = width - separatorWidth - visibleWidth(marker) - visibleWidth(markerSeparator);

	if (available <= 0) return fitToWidth(marker || joinSegments(kept, separator), width);

	const totalContent = kept.reduce((sum, segment) => sum + visibleWidth(segment.text), 0);
	if (totalContent <= available) {
		return fitToWidth(`${joinSegments(kept, separator)}${markerSeparator}${marker}`, width);
	}

	if (available < kept.length) {
		const clipped = fitToWidth(joinSegments(kept, separator), Math.max(0, available), "");
		return fitToWidth(`${clipped}${markerSeparator}${marker}`, width);
	}

	const allocations = kept.map(() => 1);
	let remaining = available - allocations.length;
	while (remaining > 0) {
		let best = -1;
		let bestNeed = 0;
		for (let index = 0; index < kept.length; index++) {
			const need = visibleWidth(kept[index]!.text) - allocations[index]!;
			if (need <= 0) continue;
			if (
				best < 0 ||
				kept[index]!.priority < kept[best]!.priority ||
				(kept[index]!.priority === kept[best]!.priority && need > bestNeed)
			) {
				best = index;
				bestNeed = need;
			}
		}
		if (best < 0) break;
		allocations[best]!++;
		remaining--;
	}

	const fitted = kept.map((segment, index) => fitToWidth(segment.text, allocations[index]!));
	const row = `${fitted.join(separator)}${markerSeparator}${marker}`;
	return fitToWidth(row, width);
}

function projectSegments(snapshot: FooterSnapshot, theme: Theme): RenderSegment[] {
	const segments: RenderSegment[] = [];
	if (snapshot.cwd) {
		const path = formatCwdForFooter(snapshot.cwd);
		if (path) {
			segments.push({
				text: theme.fg("mdLink", path),
				priority: 1,
				essential: true,
			});
		}
	}

	if (snapshot.sessionName) {
		segments.push({
			text: `in ${theme.fg("syntaxVariable", cleanOneLine(snapshot.sessionName))}`,
			priority: 3,
		});
	}
	if (snapshot.branch) {
		segments.push({
			text: `on ${theme.fg("syntaxKeyword", `⑂ ${cleanOneLine(snapshot.branch)}`)}`,
			priority: 2,
		});
	}

	const statuses = orderedStatuses(snapshot.statuses).filter(
		(status) =>
			status.key !== FLEET_NAVIGATION_STATUS &&
			status.key !== FAST_MODE_STATUS &&
			status.key !== "mcp" &&
			status.key !== "mcp-auth" &&
			sanitizeStatusText(status.text),
	);
	for (const status of statuses) {
		segments.push({
			text: styleStatus(status, theme),
			priority: 1,
			essential: true,
		});
	}
	return segments;
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

function fleetNavigationHint(snapshot: FooterSnapshot, theme: Theme): string | undefined {
	const status = snapshot.statuses.find((candidate) => candidate.key === FLEET_NAVIGATION_STATUS);
	const text = status ? sanitizeStatusText(status.text) : "";
	return text ? theme.fg("dim", text) : undefined;
}

function renderMetadataRow(snapshot: FooterSnapshot, theme: Theme, width: number): string | undefined {
	const metadata = modelMetadata(snapshot, theme);
	if (!metadata) return undefined;
	const hint = fleetNavigationHint(snapshot, theme);
	if (!hint || visibleWidth(metadata) + visibleWidth(hint) + 1 > width) return fitToWidth(metadata, width);
	return `${metadata}${" ".repeat(width - visibleWidth(metadata) - visibleWidth(hint))}${hint}`;
}

function telemetrySegments(snapshot: FooterSnapshot, theme: Theme): RenderSegment[] {
	const segments: RenderSegment[] = [];
	const context = snapshot.context;
	if (context) {
		const percent = context.percent === null ? "?" : `${context.percent.toFixed(1)}%`;
		const percentText = theme.fg(contextColor(context.percent), percent);
		const windowText = context.contextWindow > 0 ? theme.fg("dim", `/${formatTokens(context.contextWindow)}`) : "";
		const autoText = snapshot.autoCompactionEnabled ? ` ${theme.fg("dim", "(auto)")}` : "";
		segments.push({
			text: `${percentText}${windowText}${autoText}`,
			priority: 1,
			essential: true,
		});
	} else if (snapshot.autoCompactionEnabled) {
		segments.push({
			text: theme.fg("dim", "(auto)"),
			priority: 2,
		});
	}

	const usage = snapshot.usage;
	if (usage) {
		const tokenParts: string[] = [];
		if (usage.input) tokenParts.push(`↑${formatTokens(usage.input)}`);
		if (usage.output) tokenParts.push(`↓${formatTokens(usage.output)}`);
		if (usage.cacheRead) tokenParts.push(`R${formatTokens(usage.cacheRead)}`);
		if (usage.cacheWrite) tokenParts.push(`W${formatTokens(usage.cacheWrite)}`);
		if ((usage.cacheRead > 0 || usage.cacheWrite > 0) && usage.latestCacheHitRate !== undefined) {
			tokenParts.push(`CH${usage.latestCacheHitRate.toFixed(1)}%`);
		}
		if (tokenParts.length > 0) {
			segments.push({
				text: theme.fg("dim", tokenParts.join(" ")),
				priority: 3,
			});
		}
	}

	if (usage && (usage.cost !== 0 || snapshot.usingSubscription === true)) {
		segments.push({
			text: theme.fg("success", `$${usage.cost.toFixed(3)}${snapshot.usingSubscription ? " (sub)" : ""}`),
			priority: 2,
		});
	} else if (snapshot.usingSubscription === true) {
		segments.push({
			text: theme.fg("success", "$0.000 (sub)"),
			priority: 2,
		});
	}
	const mcpStatuses = snapshot.statuses.filter(
		(status) => (status.key === "mcp" || status.key === "mcp-auth") && sanitizeStatusText(status.text),
	);
	for (const status of mcpStatuses) {
		segments.push({
			text: styleStatus(status, theme),
			priority: 1,
		});
	}
	return segments;
}

function renderStripRows(snapshot: FooterSnapshot, theme: Theme, width: number): string[] {
	const identity = projectSegments(snapshot, theme);
	const telemetry = telemetrySegments(snapshot, theme);
	if (identity.length === 0 && telemetry.length === 0) return [];

	const leftSeparator = " ";
	const rightSeparator = theme.fg("dim", " | ");
	const identityText = identity.map((s) => s.text).join(leftSeparator);
	const telemetryText = telemetry.map((s) => s.text).join(rightSeparator);
	if (identityText && telemetryText && visibleWidth(identityText) + visibleWidth(telemetryText) + 1 <= width) {
		const gap = Math.max(1, width - visibleWidth(identityText) - visibleWidth(telemetryText));
		return [`${identityText}${" ".repeat(gap)}${telemetryText}`];
	}
	if (!telemetryText && visibleWidth(identityText) <= width) {
		return [identityText];
	}
	if (!identityText && visibleWidth(telemetryText) <= width) {
		return [telemetryText];
	}

	const rows: string[] = [];
	const identityRow = packSegments(identity, width, leftSeparator, theme);
	const telemetryRow = packSegments(telemetry, width, rightSeparator, theme);
	if (identityRow) rows.push(identityRow);
	if (telemetryRow) rows.push(telemetryRow);
	return rows;
}

function cardContent(line: string, width: number): string {
	return padToWidth(line, width);
}

function fillLine(content: string, width: number): string {
	const truncated = truncateToWidth(content, Math.max(0, width), "");
	const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
	return `${truncated}${pad}`;
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
 * contains only the prompt rows; autocomplete is deliberately appended by the
 * editor after this function returns.
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

	const bottomRule = fitToWidth(theme.fg("dim", renderEditorBorder(width, "below", viewport?.below)), width);

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

	// Bottom border
	rows.push(bottomRule);

	// Starship footer rows
	for (const strip of renderStripRows(snapshot, theme, width)) {
		rows.push(cardContent(strip, width));
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
	footerData: ReadonlyFooterDataProvider,
	session: TelemetrySession,
): FooterSnapshot {
	const sessionManager = safeRead(() => ctx.sessionManager);
	const cwd = sessionManager ? safeRead(() => sessionManager.getCwd()) : undefined;
	const sessionName = sessionManager ? safeRead(() => sessionManager.getSessionName()) : undefined;
	const model = safeRead(() => ctx.model);
	const modelProvider = model && typeof model.provider === "string" && model.provider ? model.provider : undefined;
	const providerName = modelProvider
		? safeRead(() => ctx.modelRegistry.getProviderDisplayName(modelProvider))
		: undefined;
	const thinkingLevel = safeRead(() => ctx.thinkingLevel);
	const contextUsage = safeRead(() => ctx.getContextUsage());
	const branch = safeRead(() => footerData.getGitBranch());
	const availableProviderCount = safeRead(() => footerData.getAvailableProviderCount());
	const statusMap = safeRead(() => footerData.getExtensionStatuses());
	const statuses = statusMap
		? [...statusMap.entries()].flatMap(([key, text]) =>
				typeof key === "string" && typeof text === "string" ? [{ key, text }] : [],
			)
		: [];

	let usage: FooterUsageTotals | undefined;
	try {
		usage = collectUsageTotals(session.sessionManager.getEntries());
	} catch {
		usage = undefined;
	}

	let usingSubscription: boolean | undefined;
	if (modelProvider) {
		usingSubscription = modelProvider === "kimi-coding";
		try {
			usingSubscription ||= session.modelRuntime.isUsingSubscription(modelProvider);
		} catch {
			// The bridge validated this method at installation. If a later Pi
			// mutation makes it unreadable, omit the qualifier rather than infer it.
			usingSubscription = undefined;
		}
	}

	const contextWindow =
		contextUsage && typeof contextUsage.contextWindow === "number"
			? contextUsage.contextWindow
			: model && typeof model.contextWindow === "number"
				? model.contextWindow
				: undefined;
	const context =
		contextWindow !== undefined && Number.isFinite(contextWindow)
			? {
					percent:
						contextUsage &&
						(contextUsage.percent === null ||
							(typeof contextUsage.percent === "number" && Number.isFinite(contextUsage.percent)))
							? contextUsage.percent
							: null,
					contextWindow,
				}
			: undefined;

	return {
		cwd: typeof cwd === "string" && cwd ? cwd : typeof ctx.cwd === "string" && ctx.cwd ? ctx.cwd : undefined,
		sessionName: typeof sessionName === "string" && sessionName ? sessionName : undefined,
		branch: typeof branch === "string" && branch ? branch : undefined,
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
		usage,
		usingSubscription,
		autoCompactionEnabled: safeRead(() => session.autoCompactionEnabled),
		fastModeEnabled:
			modelProvider !== undefined && VROOM_PROVIDERS.has(modelProvider) && statusMap?.has(FAST_MODE_STATUS) === true,
		availableProviderCount,
		statuses,
	};
}

/** Custom editor that preserves Pi's complete native editor behavior. */
export class InputCardEditor extends PiCustomEditor {
	#disposed = false;
	#unsubscribeBranch: (() => void) | undefined;

	constructor(
		private readonly ctx: ExtensionContext,
		private readonly session: TelemetrySession,
		tuiForCard: TUI,
		editorTheme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly footerData: ReadonlyFooterDataProvider,
		private readonly cardTheme: Theme,
	) {
		super(tuiForCard, editorTheme, keybindings, { paddingX: 0 });
		this.#unsubscribeBranch = footerData.onBranchChange(() => {
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
		if (width <= 2) {
			return super.render(width).map((line) => truncateToWidth(line, width, ""));
		}
		const innerWidth = Math.max(0, width - RAIL_WIDTH);
		const nativeLines = super.render(innerWidth);
		const split = splitNativeEditorLines(nativeLines);
		const snapshot = collectInputCardSnapshot(this.ctx, this.footerData, this.session);
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
	session: TelemetrySession,
	footerData: ReadonlyFooterDataProvider,
): (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => InputCardEditor {
	return (tui, theme, keybindings) =>
		new InputCardEditor(ctx, session, tui, theme, keybindings, footerData, ctx.ui.theme);
}

export const renderCard = renderInputCard;
export const collectFooterSnapshot = collectInputCardSnapshot;
export const renderStatusFooter = renderInputCard;
export const renderFooter = renderInputCard;
export type InputCardEditorFactory = ReturnType<typeof createInputCardEditorFactory>;
export type InputCardFactory = StatusFooterFactory;
