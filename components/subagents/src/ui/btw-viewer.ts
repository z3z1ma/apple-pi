/**
 * btw-viewer.ts — Dedicated answer-first conversation overlay for /btw.
 *
 * Renders Markdown assistant answers, hides parent-context envelopes,
 * displays compact read-only tool names without result bodies, and supports
 * question composition, answer injection, clearing, and stopping.
 */

import { type AgentSession, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Input,
	Markdown,
	matchesKey,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { extractText } from "../context.js";
import type { AgentRecord } from "../types.js";
import { getLifetimeTotal, getSessionContextPercent } from "../usage.js";
import {
	type AgentActivity,
	buildInvocationTags,
	describeActivity,
	fgPreservingNestedStyles,
	formatDuration,
	formatSessionTokens,
	type Theme,
} from "./agent-widget.js";
import { createViewerKeys, type ViewerKeybindings, type ViewerKeys } from "./viewer-keys.js";

/** Base lines consumed by chrome: top border + header + header sep + footer sep + footer + bottom border. */
const CHROME_LINES_BASE = 6;
const MIN_VIEWPORT = 3;

/** Height ceiling shared by the overlay's maxHeight and the viewer's viewport cap. */
export const BTW_VIEWPORT_HEIGHT_PCT = 70;

export interface BtwViewerActions {
	/** Submit a new question or follow-up to BTW. */
	onSubmitQuestion?: (question: string) => void;
	/** Inject the latest completed assistant answer back to the main conversation. */
	onInjectLatestAnswer?: (answer: string) => void;
	/** Clear the current BTW conversation session, then close overlay. */
	onClearConversation?: () => void;
	/** Stop/abort the currently running BTW turn. */
	onStop?: () => void;
	/**
	 * Convert internal child user prompt text (e.g. envelope with parent context)
	 * into user-visible question text. Return undefined or empty string to hide it.
	 */
	formatUserPrompt?: (prompt: string) => string | undefined;
}

/** Fail closed if an internal BTW envelope reaches the viewer without its formatter. */
export function defaultFormatBtwPrompt(prompt: string): string | undefined {
	const marker = "<btw-question>";
	const start = prompt.lastIndexOf(marker);
	if (start >= 0) {
		const contentStart = start + marker.length;
		const end = prompt.indexOf("</btw-question>", contentStart);
		return prompt.slice(contentStart, end < 0 ? undefined : end).trim() || undefined;
	}
	if (prompt.includes("<btw-parent-context>")) return undefined;
	return prompt.trim() || undefined;
}

export class BtwViewer implements Component {
	private scrollOffset = 0;
	private autoScroll = true;
	private unsubscribe: (() => void) | undefined;
	private lastInnerW = 0;
	private closed = false;
	private stopArmed = false;
	private keys: ViewerKeys;
	private composer: Input | undefined;
	private actions: BtwViewerActions;

	constructor(
		private tui: TUI,
		private session: AgentSession,
		private record: AgentRecord,
		private theme: Theme,
		private done: (result: undefined) => void,
		keybindings?: ViewerKeybindings,
		actionsOrOptions?: BtwViewerActions,
		private activity?: AgentActivity,
	) {
		this.keys = createViewerKeys(keybindings);
		this.actions = actionsOrOptions ?? {};
		this.unsubscribe = session.subscribe(() => {
			if (this.closed) return;
			this.tui.requestRender();
		});
	}

	handleInput(data: string): void {
		if (this.composer) {
			this.composer.handleInput(data);
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "escape") || matchesKey(data, "q")) {
			this.closed = true;
			this.done(undefined);
			return;
		}

		// Alt+X / ⌥X: Clear conversation and close
		if (matchesKey(data, "alt+x")) {
			this.stopArmed = false;
			this.actions.onClearConversation?.();
			this.closed = true;
			this.done(undefined);
			return;
		}

		// 'i' or Alt+I / ⌥I: Inject latest answer into main conversation
		if (matchesKey(data, "i") || matchesKey(data, "alt+i")) {
			this.stopArmed = false;
			const latestAnswer = this.getLatestCompletedAnswer();
			if (latestAnswer) {
				this.actions.onInjectLatestAnswer?.(latestAnswer);
			}
			this.tui.requestRender();
			return;
		}

		// Enter opens the question composer
		if (matchesKey(data, "enter") && this.canAsk()) {
			this.stopArmed = false;
			this.openComposer();
			return;
		}

		// Stop/abort: Two-press 'x'
		if (matchesKey(data, "x")) {
			if (this.isStoppable()) {
				if (this.stopArmed) {
					this.stopArmed = false;
					this.actions.onStop?.();
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
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
			this.autoScroll = this.scrollOffset >= maxScroll;
		} else if (this.keys.scrollDown(data)) {
			this.scrollOffset = Math.min(maxScroll, this.scrollOffset + 1);
			this.autoScroll = this.scrollOffset >= maxScroll;
		} else if (this.keys.pageUp(data)) {
			this.scrollOffset = Math.max(0, this.scrollOffset - viewportHeight);
			this.autoScroll = false;
		} else if (this.keys.pageDown(data)) {
			this.scrollOffset = Math.min(maxScroll, this.scrollOffset + viewportHeight);
			this.autoScroll = this.scrollOffset >= maxScroll;
		} else if (matchesKey(data, "home")) {
			this.scrollOffset = 0;
			this.autoScroll = false;
		} else if (matchesKey(data, "end")) {
			this.scrollOffset = maxScroll;
			this.autoScroll = true;
		}
	}

	render(width: number): string[] {
		if (width < 6) return [];
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
		const hrTop = th.fg("border", `╭${"─".repeat(width - 2)}╮`);
		const hrBot = th.fg("border", `╰${"─".repeat(width - 2)}╯`);
		const hrMid = row(th.fg("dim", "─".repeat(innerW)));

		// Header
		lines.push(hrTop);
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
		const tokens = getLifetimeTotal(this.activity?.lifetimeUsage ?? this.record.lifetimeUsage);
		if (tokens > 0) {
			const percent = getSessionContextPercent(this.activity?.session ?? this.record.session);
			headerParts.push(formatSessionTokens(tokens, percent, th, this.record.compactionCount));
		}

		const title = th.bold("BTW");
		const subtitle = th.fg("muted", "Side Channel");
		lines.push(
			row(
				`${statusIcon} ${title} ${th.fg("dim", "·")} ${subtitle} ${th.fg("dim", "·")} ${fgPreservingNestedStyles(th, "muted", headerParts.join(" · "))}`,
			),
		);
		const invocationLine = this.invocationLine();
		if (invocationLine) lines.push(row(invocationLine));
		lines.push(hrMid);

		// Content area
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
			lines.push(row(this.composer.render(innerW)[0] ?? ""));
			const composeHint = th.fg("dim", "Enter send · Esc cancel");
			const composeLeft = th.fg("accent", "? ask BTW");
			const composeGap = Math.max(1, innerW - visibleWidth(composeLeft) - visibleWidth(composeHint));
			lines.push(row(composeLeft + " ".repeat(composeGap) + composeHint));
		} else {
			const sep = th.fg("dim", " · ");
			const actions: string[] = [];
			if (this.canAsk()) actions.push(th.fg("dim", "Enter ask"));

			const hasAnswer = Boolean(this.getLatestCompletedAnswer());
			if (this.actions.onInjectLatestAnswer && hasAnswer) {
				actions.push(th.fg("accent", "i/⌥I inject"));
			}

			if (this.actions.onClearConversation) {
				actions.push(th.fg("dim", "⌥X clear"));
			}

			if (this.isStoppable()) {
				actions.push(this.stopArmed ? th.fg("error", "x again to STOP") : th.fg("dim", "x stop"));
			}

			const footerRight = th.fg("dim", "↑↓ scroll · Esc close");
			const footerLeft = actions.join(sep);

			const footerGap = Math.max(1, innerW - visibleWidth(footerLeft) - visibleWidth(footerRight));
			lines.push(row(footerLeft + " ".repeat(footerGap) + footerRight));
		}
		lines.push(hrBot);

		return lines;
	}

	invalidate(): void {
		/* no cached state */
	}

	dispose(): void {
		this.closed = true;
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = undefined;
		}
	}

	// ---- State Helpers ----

	private isStoppable(): boolean {
		return !!this.actions.onStop && (this.record.status === "running" || this.record.status === "queued");
	}

	private canAsk(): boolean {
		return !!this.actions.onSubmitQuestion;
	}

	private openComposer(): void {
		const input = new Input();
		input.focused = true;
		input.onSubmit = (value: string) => {
			const question = value.trim();
			this.composer = undefined;
			if (question) {
				this.autoScroll = true;
				this.actions.onSubmitQuestion?.(question);
			}
			this.tui.requestRender();
		};
		input.onEscape = () => {
			this.composer = undefined;
			this.tui.requestRender();
		};
		this.composer = input;
		this.tui.requestRender();
	}

	private viewportHeight(): number {
		const maxRows = Math.floor((this.tui.terminal.rows * BTW_VIEWPORT_HEIGHT_PCT) / 100);
		return Math.max(MIN_VIEWPORT, maxRows - this.chromeLines());
	}

	private chromeLines(): number {
		return CHROME_LINES_BASE + (this.invocationLine() ? 1 : 0) + (this.composer ? 1 : 0);
	}

	private invocationLine(): string | undefined {
		const { modelName, tags } = buildInvocationTags(this.record.invocation);
		const parts = modelName ? [modelName, ...tags] : tags;
		if (parts.length === 0) return undefined;
		return this.theme.fg("muted", `  ↳ ${parts.join(" · ")}`);
	}

	public getLatestCompletedAnswer(): string | undefined {
		const messages = this.session.messages;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg?.role === "assistant" && msg.stopReason !== "pending" && Array.isArray(msg.content)) {
				const textParts: string[] = [];
				for (const c of msg.content) {
					if (c && typeof c === "object" && c.type === "text" && typeof c.text === "string") {
						textParts.push(c.text);
					}
				}
				const fullText = textParts.join("\n").trim();
				if (fullText) return fullText;
			}
		}
		return undefined;
	}

	private formatUserQuestion(rawPrompt: string): string | undefined {
		if (this.actions.formatUserPrompt) {
			return this.actions.formatUserPrompt(rawPrompt);
		}
		return defaultFormatBtwPrompt(rawPrompt);
	}

	private renderMarkdownLines(text: string, width: number): string[] {
		if (!text.trim() || width <= 0) return [];
		try {
			const mdTheme = getMarkdownTheme();
			const md = new Markdown(text.trim(), 0, 0, mdTheme);
			return md.render(width);
		} catch {
			return wrapTextWithAnsi(text.trim(), width).map((line) => this.theme.fg("text", line));
		}
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Ordered presentation of live BTW stream and history
	private buildContentLines(width: number): string[] {
		if (width <= 0) return [];

		const th = this.theme;
		const messages = [...this.session.messages];
		const streaming = this.session.state?.streamingMessage;
		const lines: string[] = [];

		if (messages.length === 0 && !streaming) {
			lines.push(th.fg("muted", "(waiting for first question...)"));
			return lines.map((l) => truncateToWidth(l, width));
		}

		let needsSeparator = false;

		for (const msg of messages) {
			if (msg.role === "user") {
				const rawText = typeof msg.content === "string" ? msg.content : extractText(msg.content);
				const visibleQuestion = this.formatUserQuestion(rawText);
				if (!visibleQuestion) continue;

				if (needsSeparator) lines.push(th.fg("dim", "───"));
				lines.push(th.fg("accent", `? ${visibleQuestion}`));
				needsSeparator = true;
			} else if (msg.role === "assistant") {
				const textParts: string[] = [];
				const toolCalls: string[] = [];
				if (Array.isArray(msg.content)) {
					for (const c of msg.content) {
						if (c && typeof c === "object") {
							if (c.type === "text" && c.text) textParts.push(c.text);
							else if (c.type === "toolCall") {
								toolCalls.push((c as any).name ?? (c as any).toolName ?? "unknown");
							}
						}
					}
				}

				if (textParts.length > 0 || toolCalls.length > 0) {
					if (needsSeparator) lines.push(th.fg("dim", "───"));
					for (const toolName of toolCalls) {
						lines.push(truncateToWidth(th.fg("muted", `↳ tool: ${toolName}`), width));
					}
					if (textParts.length > 0) {
						const mdLines = this.renderMarkdownLines(textParts.join("\n"), width);
						lines.push(...mdLines);
					}
					needsSeparator = true;
				}
			}
			// Skip toolResult bodies entirely for a clean answer-first UI
		}

		// Streaming assistant message
		if (
			streaming &&
			messages.at(-1) !== streaming &&
			streaming.role === "assistant" &&
			Array.isArray(streaming.content)
		) {
			const streamParts: string[] = [];
			const streamTools: string[] = [];
			for (const c of streaming.content) {
				if (c && typeof c === "object") {
					if (c.type === "text" && c.text) streamParts.push(c.text);
					else if (c.type === "toolCall") {
						streamTools.push((c as any).name ?? (c as any).toolName ?? "unknown");
					}
				}
			}

			if (streamParts.length > 0 || streamTools.length > 0) {
				if (needsSeparator) lines.push(th.fg("dim", "───"));
				for (const toolName of streamTools) {
					lines.push(truncateToWidth(th.fg("muted", `↳ tool: ${toolName}`), width));
				}
				if (streamParts.length > 0) {
					const mdLines = this.renderMarkdownLines(streamParts.join("\n"), width);
					lines.push(...mdLines);
				}
				needsSeparator = true;
			}
		}

		// Live generating indicator
		if (this.record.status === "running") {
			const act = this.activity ? describeActivity(this.activity.activeTools, this.activity.responseText) : "thinking…";
			lines.push("");
			lines.push(truncateToWidth(th.fg("accent", "▍ ") + th.fg("thinkingText", act), width));
		}

		return lines.map((l) => truncateToWidth(l, width));
	}
}
