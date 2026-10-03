/**
 * conversation-viewer.ts — Live conversation view of one agent session.
 *
 * Displays a scrollable, live-updating view of an agent's conversation inside
 * the glanceable agent panel. Subscribes to session events for real-time
 * streaming updates.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Input,
	matchesKey,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { renderAgentName } from "../agent-color.js";
import { extractText } from "../context.js";
import type { AgentRecord } from "../types.js";
import { getLifetimeTotal, getSessionContextPercent } from "../usage.js";
import type { Theme } from "./agent-widget.js";
import {
	type AgentActivity,
	buildInvocationTags,
	describeActivity,
	fgPreservingNestedStyles,
	formatDuration,
	formatSessionTokens,
	getPromptModeLabel,
} from "./agent-widget.js";
import {
	createViewerKeys,
	formatViewerKey,
	type ViewerKeybindings,
	type ViewerKeys,
} from "../../../shared/src/viewer-keys.js";

/** Base lines consumed by chrome: top border + header + header sep + footer sep + footer + bottom border. */
const CHROME_LINES_BASE = 6;
/** Height ceiling shared by the overlay's `maxHeight` and the viewer's internal viewport cap. */
export const VIEWPORT_HEIGHT_PCT = 70;

/** Esc returns keyboard focus to the editor; q unpins the panel. */
export type ConversationViewerAction = "unfocus" | "unpin";

export class ConversationViewer implements Component {
	/** Rows the embedding panel draws above this view, deducted from the height ceiling. */
	reservedRows = 0;
	/** Draw a `├─┤` joint instead of a rounded top border so the view continues a panel box. */
	joinTop = false;
	private scrollOffset = 0;
	private autoScroll = true;
	private unsubscribe: (() => void) | undefined;
	private subscribedSession: AgentSession | undefined;
	private readonly refreshTimer: ReturnType<typeof setInterval>;
	private lastInnerW = 0;
	private closed = false;
	/** Two-press confirm guard for the stop key, so a stray key can't kill the agent. */
	private stopArmed = false;
	private keys: ViewerKeys;
	/** Steering composer — present while the user is typing a message to the agent. */
	private composer: Input | undefined;
	private hasFocus = false;

	/**
	 * Keyboard focus, set by the embedding panel. It reaches the composer so the
	 * hardware cursor (and IME window) follows real focus; losing focus also
	 * drops a pending stop confirmation.
	 */
	get focused(): boolean {
		return this.hasFocus;
	}

	set focused(value: boolean) {
		this.hasFocus = value;
		if (this.composer) this.composer.focused = value;
		if (!value) this.stopArmed = false;
	}

	constructor(
		private tui: TUI,
		private session: AgentSession | undefined,
		private record: AgentRecord,
		private activity: AgentActivity | undefined,
		private theme: Theme,
		private done: (action: ConversationViewerAction) => void,
		/** Abort the agent shown here. Omitted → no stop affordance (e.g. read-only history). */
		private onStop?: () => void,
		/** User keybindings from `ctx.ui.custom()`. Omitted → hardcoded defaults. */
		keybindings?: ViewerKeybindings,
		/** Send a steering message to the agent. Omitted → no compose affordance. */
		private onSteer?: (message: string) => void,
	) {
		this.keys = createViewerKeys(keybindings);
		this.bindSession();
		this.refreshTimer = setInterval(() => {
			if (this.closed) return;
			this.bindSession();
			this.tui.requestRender();
		}, 500);
		this.refreshTimer.unref();
	}

	private bindSession(): void {
		const next = this.record.session ?? this.session;
		if (next === this.subscribedSession) return;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.subscribedSession = next;
		this.session = next;
		if (!next) return;
		this.unsubscribe = next.subscribe(() => {
			if (this.closed) return;
			this.tui.requestRender();
		});
	}

	handleInput(data: string): void {
		// While composing a steer message, the input owns all keys (Enter sends,
		// Esc cancels — both wired in openComposer()). Editing keys flow through.
		if (this.composer) {
			this.composer.handleInput(data);
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "escape")) {
			this.stopArmed = false;
			this.done("unfocus");
			return;
		}
		if (matchesKey(data, "q")) {
			this.done("unpin");
			return;
		}

		// Enter opens the steering composer (only while the agent can still be
		// steered) — then type + Enter sends, Esc or an empty submit returns. When
		// not steerable, fall through so the key still disarms a pending stop.
		if (matchesKey(data, "enter") && this.canSteer()) {
			this.stopArmed = false;
			this.openComposer();
			return;
		}

		// Stop/abort the agent (only while it can still be stopped). Two-press:
		// first "x" arms, second confirms — any other key disarms.
		if (matchesKey(data, "x")) {
			if (this.isStoppable()) {
				if (this.stopArmed) {
					this.stopArmed = false;
					this.onStop?.();
				} else {
					this.stopArmed = true;
				}
				this.tui.requestRender();
			}
			return;
		}
		if (this.stopArmed) this.stopArmed = false;

		const totalLines = this.buildContentLines(this.lastInnerW).length;
		const viewportHeight = this.viewportHeight();
		const maxScroll = Math.max(0, totalLines - viewportHeight);

		if (this.keys.scrollUp(data)) {
			this.scrollBy(-1);
		} else if (this.keys.scrollDown(data)) {
			this.scrollBy(1);
		} else if (this.keys.pageUp(data)) {
			this.scrollBy(-viewportHeight);
		} else if (this.keys.pageDown(data)) {
			this.scrollBy(viewportHeight);
		} else if (matchesKey(data, "home")) {
			this.scrollOffset = 0;
			this.autoScroll = false;
		} else if (matchesKey(data, "end")) {
			this.scrollOffset = maxScroll;
			this.autoScroll = true;
		}
	}

	/** Scroll the conversation by lines; negative moves up. Reaching the end resumes following new output. */
	scrollBy(lines: number): void {
		const maxScroll = Math.max(0, this.buildContentLines(this.lastInnerW).length - this.viewportHeight());
		this.scrollOffset = Math.min(maxScroll, Math.max(0, this.scrollOffset + lines));
		this.autoScroll = this.scrollOffset >= maxScroll;
		this.tui.requestRender();
	}

	render(width: number): string[] {
		if (width < 6) return []; // too narrow for any meaningful rendering
		const th = this.theme;
		const innerW = width - 4; // border + padding
		this.lastInnerW = innerW;
		const lines: string[] = [];

		const pad = (s: string, len: number) => {
			const vis = visibleWidth(s);
			return s + " ".repeat(Math.max(0, len - vis));
		};
		const row = (content: string) =>
			th.fg("border", "│") +
			" " +
			truncateToWidth(pad(content, innerW), innerW, "...", true) +
			" " +
			th.fg("border", "│");
		const hrTop = this.joinTop
			? th.fg("border", `├${"─".repeat(width - 2)}┤`)
			: th.fg("border", `╭${"─".repeat(width - 2)}╮`);
		const hrBot = th.fg("border", `╰${"─".repeat(width - 2)}╯`);
		const hrMid = row(th.fg("dim", "─".repeat(innerW)));

		// Header
		lines.push(hrTop);
		const modeLabel = getPromptModeLabel(this.record.type);
		const modeTag = modeLabel ? ` ${th.fg("dim", `(${modeLabel})`)}` : "";
		const statusIcon =
			this.record.status === "running"
				? th.fg("accent", "●")
				: this.record.status === "completed"
					? th.fg("success", "✓")
					: this.record.status === "error"
						? th.fg("error", "✗")
						: th.fg("dim", "○");
		const duration = formatDuration(this.record.startedAt, this.record.completedAt);

		const headerParts: string[] = [duration];
		const toolUses = this.activity?.toolUses ?? this.record.toolUses;
		if (toolUses > 0) headerParts.unshift(`${toolUses} tool${toolUses === 1 ? "" : "s"}`);
		const tokens = getLifetimeTotal(this.activity?.lifetimeUsage);
		if (tokens > 0) {
			const percent = getSessionContextPercent(this.activity?.session);
			headerParts.push(formatSessionTokens(tokens, percent, th, this.record.compactionCount));
		}

		lines.push(
			row(
				`${statusIcon} ${renderAgentName(this.record.type, th, { bold: true })}${modeTag}  ${th.fg("text", this.record.description)} ${th.fg("dim", "·")} ${fgPreservingNestedStyles(th, "muted", headerParts.join(" · "))}`,
			),
		);
		const invocationLine = this.invocationLine();
		if (invocationLine) lines.push(row(invocationLine));
		lines.push(hrMid);

		// Content area — rebuild every render (live data, no cache needed)
		const contentLines = this.buildContentLines(innerW);
		const viewportHeight = this.viewportHeight();
		const maxScroll = Math.max(0, contentLines.length - viewportHeight);

		if (this.autoScroll) {
			this.scrollOffset = maxScroll;
		}

		const visibleStart = Math.min(this.scrollOffset, maxScroll);
		const visible = contentLines.slice(visibleStart, visibleStart + viewportHeight);

		for (let i = 0; i < viewportHeight; i++) {
			lines.push(row(visible[i] ?? ""));
		}

		// Footer
		lines.push(hrMid);
		if (this.composer) {
			// Composer row: the Input renders its own `> ` prompt and cursor.
			lines.push(row(this.composer.render(innerW)[0] ?? ""));
			const composeHint = th.fg("dim", "Enter send · Esc cancel");
			const composeLeft = th.fg("accent", "✎ steer");
			const composeGap = Math.max(1, innerW - visibleWidth(composeLeft) - visibleWidth(composeHint));
			lines.push(row(composeLeft + " ".repeat(composeGap) + composeHint));
		} else {
			// Actions on the left, navigation on the right. The scroll hint keeps its
			// full key list so the less-obvious bindings stay discoverable; it leads
			// the right group so the Esc/q hints are the part that truncates first.
			const sep = th.fg("dim", " · ");
			const actions: string[] = [];
			if (this.canSteer()) actions.push(th.fg("dim", "Enter steer"));
			if (this.isStoppable()) {
				actions.push(this.stopArmed ? th.fg("error", "x again to STOP") : th.fg("dim", "x stop"));
			}
			const footerRight = th.fg(
				"dim",
				`${formatViewerKey(this.keys.upKey)}/${formatViewerKey(this.keys.downKey)} scroll · ${formatViewerKey(this.keys.pageUpKey)}/${formatViewerKey(this.keys.pageDownKey)} page · Esc editor · q unpin`,
			);

			// Prepend the line-count/scroll-% readout only when there's spare width —
			// it's the first thing dropped so it never crowds out the hints.
			const scrollPct =
				contentLines.length <= viewportHeight
					? "100%"
					: `${Math.round(((visibleStart + viewportHeight) / contentLines.length) * 100)}%`;
			const count = th.fg("dim", `${contentLines.length} lines · ${scrollPct}`);
			const withCount = [count, ...actions].join(sep);
			const footerLeft =
				visibleWidth(withCount) + visibleWidth(footerRight) + 1 <= innerW ? withCount : actions.join(sep);

			const footerGap = Math.max(1, innerW - visibleWidth(footerLeft) - visibleWidth(footerRight));
			lines.push(row(footerLeft + " ".repeat(footerGap) + footerRight));
		}
		lines.push(hrBot);

		const maxRows = this.maxRows();
		if (lines.length <= maxRows) return lines;
		if (this.composer) {
			// Never hide the input while it owns the keyboard: Enter would send an unseen draft.
			const composerRow = lines.at(-3) as string;
			return maxRows >= 2 ? [lines[1] as string, composerRow] : [composerRow];
		}
		const compact = [lines[1] ?? lines[0], lines.at(-2) ?? lines.at(-1)].filter(
			(line): line is string => line !== undefined,
		);
		return compact.slice(0, maxRows);
	}

	/** Fewest rows that show the full chrome, any open composer, and one conversation row. */
	minimumRows(): number {
		return this.chromeLines() + 1;
	}

	/** Follow a replaced activity tracker (e.g. after a resume) without resetting view state. */
	setActivity(activity: AgentActivity | undefined): void {
		this.activity = activity;
	}

	/** True while the steering composer owns keyboard input. */
	isComposing(): boolean {
		return this.composer !== undefined;
	}

	/** Stoppable only when a stop handler exists and the agent is still active. */
	private isStoppable(): boolean {
		return !!this.onStop && (this.record.status === "running" || this.record.status === "queued");
	}

	/** Steerable only when a steer handler exists and the agent is still active. */
	private canSteer(): boolean {
		return !!this.onSteer && (this.record.status === "running" || this.record.status === "queued");
	}

	/** Open the inline steering composer and route subsequent input to it. */
	private openComposer(): void {
		const input = new Input();
		input.focused = this.hasFocus;
		input.onSubmit = (value: string) => {
			const message = value.trim();
			this.composer = undefined;
			if (message) this.onSteer?.(message);
			this.tui.requestRender();
		};
		input.onEscape = () => {
			this.composer = undefined;
			this.tui.requestRender();
		};
		this.composer = input;
		this.tui.requestRender();
	}

	invalidate(): void {
		/* no cached state to clear */
	}

	dispose(): void {
		this.closed = true;
		clearInterval(this.refreshTimer);
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = undefined;
		}
	}

	// ---- Private ----

	private viewportHeight(): number {
		// Cap mirrors the overlay's maxHeight — otherwise the viewer would render
		// more lines than the overlay shows and clip the footer.
		return Math.max(0, this.maxRows() - this.chromeLines());
	}

	private maxRows(): number {
		return Math.max(1, Math.floor((this.tui.terminal.rows * VIEWPORT_HEIGHT_PCT) / 100) - this.reservedRows);
	}

	private chromeLines(): number {
		// The composer adds one row above the footer hint while it's open.
		return CHROME_LINES_BASE + (this.invocationLine() ? 1 : 0) + (this.composer ? 1 : 0);
	}

	private invocationLine(): string | undefined {
		const { modelName, tags } = buildInvocationTags(this.record.invocation);
		const parts = modelName ? [modelName, ...tags] : tags;
		if (parts.length === 0) return undefined;
		return this.theme.fg("muted", `  ↳ ${parts.join(" · ")}`);
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this view builds one ordered transcript with all display-state branches.
	private buildContentLines(width: number): string[] {
		if (width <= 0) return [];

		const th = this.theme;
		const committed = this.session?.messages ?? [];
		// Pi holds the in-progress assistant message outside `messages` until
		// message_end; show it so long answers stream instead of appearing frozen.
		const streaming = this.session?.state?.streamingMessage;
		const messages =
			streaming && streaming.role === "assistant" && committed.at(-1) !== streaming
				? [...committed, streaming]
				: committed;
		const lines: string[] = [];

		if (messages.length === 0) {
			lines.push(th.fg("muted", "(waiting for first message...)"));
			return lines;
		}

		let needsSeparator = false;
		for (const msg of messages) {
			if (msg.role === "user") {
				const text = typeof msg.content === "string" ? msg.content : extractText(msg.content);
				if (!text.trim()) continue;
				if (needsSeparator) lines.push(th.fg("dim", "───"));
				lines.push(th.fg("accent", "[User]"));
				for (const line of wrapTextWithAnsi(text.trim(), width)) {
					lines.push(th.fg("text", line));
				}
			} else if (msg.role === "assistant") {
				const textParts: string[] = [];
				const toolCalls: string[] = [];
				for (const c of msg.content) {
					if (c.type === "text" && c.text) textParts.push(c.text);
					else if (c.type === "toolCall") {
						toolCalls.push((c as any).name ?? (c as any).toolName ?? "unknown");
					}
				}
				if (needsSeparator) lines.push(th.fg("dim", "───"));
				lines.push(th.bold("[Assistant]"));
				if (textParts.length > 0) {
					for (const line of wrapTextWithAnsi(textParts.join("\n").trim(), width)) {
						lines.push(th.fg("text", line));
					}
				}
				for (const name of toolCalls) {
					lines.push(truncateToWidth(th.fg("muted", `  [Tool: ${name}]`), width));
				}
			} else if (msg.role === "toolResult") {
				const text = extractText(msg.content);
				const truncated = text.length > 500 ? `${text.slice(0, 500)}... (truncated)` : text;
				if (!truncated.trim()) continue;
				if (needsSeparator) lines.push(th.fg("dim", "───"));
				lines.push(th.fg("muted", "[Result]"));
				for (const line of wrapTextWithAnsi(truncated.trim(), width)) {
					lines.push(th.fg("text", line));
				}
			} else if ((msg as any).role === "bashExecution") {
				const bash = msg as any;
				if (needsSeparator) lines.push(th.fg("dim", "───"));
				lines.push(truncateToWidth(th.fg("muted", `  $ ${bash.command}`), width));
				if (bash.output?.trim()) {
					const out = bash.output.length > 500 ? `${bash.output.slice(0, 500)}... (truncated)` : bash.output;
					for (const line of wrapTextWithAnsi(out.trim(), width)) {
						lines.push(th.fg("text", line));
					}
				}
			} else {
				continue;
			}
			needsSeparator = true;
		}

		// Streaming indicator for running agents
		if (this.record.status === "running" && this.activity) {
			const act = describeActivity(this.activity.activeTools, this.activity.responseText);
			lines.push("");
			lines.push(truncateToWidth(th.fg("accent", "▍ ") + th.fg("thinkingText", act), width));
		}

		return lines.map((l) => truncateToWidth(l, width));
	}
}
