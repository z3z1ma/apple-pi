import {
	AssistantMessageComponent,
	BranchSummaryMessageComponent,
	CompactionSummaryMessageComponent,
	ExtensionRunner,
	getMarkdownTheme,
	Theme,
	ToolExecutionComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	formatCollapsedLine,
	formatCompactionSummary,
	formatExpandedLines,
	formatThoughtHeader,
	formatThoughtSnippet,
	formatUserMessage,
	makeMarkdownTheme,
	stripAnsi,
} from "./formatters.js";
import type { ToolStatus } from "./types.js";

const PATCH_APPLIED = Symbol.for("apple_pi.terse_tools_patched");

let activeTheme: Theme | undefined;

const userMessageRenderCache = new WeakMap<
	object,
	{ text: string; width: number; theme: Theme; renderedLines: string[] }
>();

const fallbackTheme: Theme = {
	fg(color: string, text: string) {
		switch (color) {
			case "accent":
			case "toolTitle":
				return `\x1b[36m${text}\x1b[39m`;
			case "warning":
				return `\x1b[33m${text}\x1b[39m`;
			case "success":
				return `\x1b[32m${text}\x1b[39m`;
			case "error":
				return `\x1b[31m${text}\x1b[39m`;
			case "muted":
			case "dim":
				return `\x1b[2m${text}\x1b[22m`;
			case "toolDiffAdded":
				return `\x1b[32m${text}\x1b[39m`;
			case "toolDiffRemoved":
				return `\x1b[31m${text}\x1b[39m`;
			default:
				return text;
		}
	},
	bg(_color: string, text: string) {
		return text;
	},
	bold(text: string) {
		return `\x1b[1m${text}\x1b[22m`;
	},
	italic(text: string) {
		return `\x1b[3m${text}\x1b[23m`;
	},
	underline(text: string) {
		return `\x1b[4m${text}\x1b[24m`;
	},
	inverse(text: string) {
		return `\x1b[7m${text}\x1b[27m`;
	},
	strikethrough(text: string) {
		return `\x1b[9m${text}\x1b[29m`;
	},
} as unknown as Theme;

export function getActiveTheme(): Theme {
	return activeTheme ?? fallbackTheme;
}

export function setActiveTheme(theme: Theme): void {
	activeTheme = theme;
}

export function isTransparentChild(child: any): boolean {
	if (!child) return true;
	if (child.constructor?.name === "Spacer") return true;
	if (child instanceof AssistantMessageComponent || child.constructor?.name === "AssistantMessageComponent") {
		const container = (child as any).contentContainer;
		if (container && Array.isArray(container.children) && container.children.length === 0) {
			return true;
		}
		const msg = (child as any).lastMessage;
		if (!msg) return true;
		const hasTools = msg.content?.some((c: any) => c.type === "toolCall");
		const hasText = msg.content?.some((c: any) => c.type === "text" && c.text?.trim());
		const hasThinking = msg.content?.some((c: any) => c.type === "thinking" && c.thinking?.trim());
		const hasStopError =
			msg.stopReason === "length" || (!hasTools && (msg.stopReason === "aborted" || msg.stopReason === "error"));
		if (hasTools && !hasText && !hasThinking && !hasStopError) {
			return true;
		}
	}
	return false;
}

export function isLastToolInSequence(component: ToolExecutionComponent): boolean {
	const parent = (component as any).parentContainer;
	if (!parent || !Array.isArray(parent.children)) return true;
	const children: any[] = parent.children;
	const index = children.indexOf(component);
	if (index === -1) return true;

	for (let i = index + 1; i < children.length; i++) {
		const next = children[i];
		if (next instanceof ToolExecutionComponent || next?.constructor?.name === "ToolExecutionComponent") {
			return false;
		}
		if (isTransparentChild(next)) {
			continue;
		}
		return true;
	}
	return true;
}

export function isFirstToolInSequence(component: ToolExecutionComponent): boolean {
	const parent = (component as any).parentContainer;
	if (!parent || !Array.isArray(parent.children)) return false;
	const children: any[] = parent.children;
	const index = children.indexOf(component);
	if (index <= 0) return false;

	for (let i = index - 1; i >= 0; i--) {
		const prev = children[i];
		if (isTransparentChild(prev)) continue;
		return !(prev instanceof ToolExecutionComponent || prev?.constructor?.name === "ToolExecutionComponent");
	}
	return false;
}

export function precedingHasTextDelta(component: ToolExecutionComponent): boolean {
	const parent = (component as any).parentContainer;
	if (!parent || !Array.isArray(parent.children)) return false;
	const children: any[] = parent.children;
	const index = children.indexOf(component);
	if (index <= 0) return false;

	for (let i = index - 1; i >= 0; i--) {
		const prev = children[i];
		if (prev?.constructor?.name === "Spacer") continue;
		if (prev instanceof ToolExecutionComponent || prev?.constructor?.name === "ToolExecutionComponent") {
			return false;
		}
		if (prev instanceof AssistantMessageComponent || prev?.constructor?.name === "AssistantMessageComponent") {
			if (isTransparentChild(prev)) continue;
			const msg = (prev as any).lastMessage;
			const hasText = msg?.content?.some((c: any) => c.type === "text" && c.text?.trim());
			return Boolean(hasText);
		}
		return true;
	}
	return false;
}

export function precedingIsToolCall(component: AssistantMessageComponent): boolean {
	const parent = (component as any).parentContainer;
	if (!parent || !Array.isArray(parent.children)) return false;
	const children: any[] = parent.children;
	const index = children.indexOf(component);
	if (index <= 0) return false;

	for (let i = index - 1; i >= 0; i--) {
		const prev = children[i];
		if (isTransparentChild(prev)) continue;
		return prev instanceof ToolExecutionComponent || prev?.constructor?.name === "ToolExecutionComponent";
	}
	return false;
}

function collectNonThinkingChildren(container: { children: any[] }): any[] {
	const children: any[] = [];
	for (const child of container.children) {
		if (!child || child.constructor?.name === "Spacer" || child.constructor?.name === "MouseRegion") continue;
		if (child.constructor?.name === "Markdown") {
			if ((child as any).defaultTextStyle?.italic !== true) children.push(child);
			continue;
		}
		if (child.constructor?.name === "Text") {
			const text = (child as any).text ?? "";
			const stripped = stripAnsi(text).trim();
			if (
				stripped !== "" &&
				stripped !== "Thinking..." &&
				stripped !== "Thinking…" &&
				!stripped.startsWith("▶ Thought")
			) {
				children.push(child);
			}
			continue;
		}
		children.push(child);
	}
	return children;
}

export function customizeThinkingDisplay(comp: AssistantMessageComponent): void {
	const msg = (comp as any).lastMessage;
	if (!msg || !Array.isArray(msg.content)) return;

	// Always ensure hiddenThinkingLabel is empty so Pi never generates "Thinking..."
	(comp as any).hiddenThinkingLabel = "";

	const hasTools = msg.content.some((c: any) => c.type === "toolCall");
	const hasText = msg.content.some((c: any) => c.type === "text" && c.text?.trim());
	const hasStopError =
		msg.stopReason === "length" || (!hasTools && (msg.stopReason === "aborted" || msg.stopReason === "error"));

	const container = (comp as any).contentContainer;
	if (!container || !Array.isArray(container.children)) return;

	const thinkingBlocks: string[] = [];
	for (const c of msg.content) {
		if (c.type === "thinking" && c.thinking?.trim()) {
			thinkingBlocks.push(c.thinking.trim());
		}
	}

	// If no thinking and no text, clear container completely
	if (thinkingBlocks.length === 0 && !hasText && !hasStopError) {
		container.clear();
		return;
	}

	if (thinkingBlocks.length > 0) {
		const nonThinkingChildren = collectNonThinkingChildren(container);
		container.clear();

		if ((comp as any).hideThinkingBlock) {
			if (nonThinkingChildren.length > 0) {
				container.addChild(new Spacer(1));
				for (const child of nonThinkingChildren) container.addChild(child);
			}
			return;
		}

		const theme = getActiveTheme();
		const durationMs = (comp as any)._durationMs;
		const tokens = msg.usage?.outputTokens ?? msg.usage?.totalTokens;
		const header = formatThoughtHeader(durationMs, tokens, theme);
		const fullThinking = thinkingBlocks.join("\n\n");
		const snippet = formatThoughtSnippet(fullThinking, 120, theme);
		const cardText = snippet ? `${header}\n${snippet}` : header;

		container.addChild(new Spacer(1));
		container.addChild(new Text(cardText, (comp as any).outputPad ?? 1, 0));
		if (nonThinkingChildren.length > 0) {
			container.addChild(new Spacer(1));
			for (const child of nonThinkingChildren) container.addChild(child);
		}
	}
}

export function installTerseToolRenderer(): void {
	if ((ToolExecutionComponent as any)[PATCH_APPLIED]) {
		return;
	}
	(ToolExecutionComponent as any)[PATCH_APPLIED] = true;
	(AssistantMessageComponent.prototype as any).hiddenThinkingLabel = "";

	const origAddChild = Container.prototype.addChild;
	Container.prototype.addChild = function (component: any) {
		if (component && typeof component === "object") {
			component.parentContainer = this;
		}
		return origAddChild.call(this, component);
	};

	const origFg = Theme.prototype.fg;
	Theme.prototype.fg = function (color: any, text: any) {
		activeTheme = this;
		return origFg.call(this, color, text);
	};

	const origUpdateContent = AssistantMessageComponent.prototype.updateContent;
	AssistantMessageComponent.prototype.updateContent = function (message: any, isStreaming?: boolean) {
		(this as any).hiddenThinkingLabel = "";
		if (!(this as any)._startTime) {
			(this as any)._startTime = Date.now();
		}
		if (!isStreaming) {
			(this as any)._durationMs = Date.now() - (this as any)._startTime;
		}

		origUpdateContent.call(this, message, isStreaming);
		customizeThinkingDisplay(this);
	};

	const origAssistantRender = AssistantMessageComponent.prototype.render;
	AssistantMessageComponent.prototype.render = function (width: number): string[] {
		const msg = (this as any).lastMessage;
		const isStreaming = (this as any).isStreaming;
		if (msg) {
			const hasTools = msg.content?.some((c: any) => c.type === "toolCall");
			const hasText = msg.content?.some((c: any) => c.type === "text" && c.text?.trim());
			const hasThinking = msg.content?.some((c: any) => c.type === "thinking" && c.thinking?.trim());
			const hasStopError =
				msg.stopReason === "length" || (!hasTools && (msg.stopReason === "aborted" || msg.stopReason === "error"));

			// While streaming thinking (no tools yet and no text yet), do not show thinking in transcript
			if (isStreaming && !hasTools && !hasText && !hasStopError) {
				return [];
			}

			// Tool-only without thinking or text and without error
			if (hasTools && !hasText && !hasThinking && !hasStopError) {
				return [];
			}
		}

		let lines = origAssistantRender.call(this, width);

		// Filter out any standalone "Thinking..." lines
		lines = lines.filter((line) => {
			const text = stripAnsi(line).trim();
			return text !== "Thinking..." && text !== "Thinking…" && text.toLowerCase() !== "thinking...";
		});

		// If lines only contain empty/whitespace lines and there is no text/error, return []
		if (lines.length > 0 && lines.every((l) => l.trim() === "")) {
			return [];
		}

		// Collapse multiple leading blank lines
		while (lines.length > 1 && lines[0] === "" && lines[1] === "") {
			lines.shift();
		}

		// Ensure exactly one leading blank line if preceded by a tool execution
		if (precedingIsToolCall(this) && lines.length > 0 && lines[0] !== "") {
			lines.unshift("");
		}

		// Ensure a single line break at the bottom of the thought card before tool calls
		if (msg) {
			const hasTools = msg.content?.some((c: any) => c.type === "toolCall");
			const hasText = msg.content?.some((c: any) => c.type === "text" && c.text?.trim());
			const hasThinking = msg.content?.some((c: any) => c.type === "thinking" && c.thinking?.trim());
			if (hasTools && !hasText && hasThinking && lines.length > 0) {
				while (lines.length > 1 && lines[lines.length - 1] === "" && lines[lines.length - 2] === "") {
					lines.pop();
				}
				if (lines[lines.length - 1] !== "") {
					lines.push("");
				}
			}
		}

		if (width > 0) {
			return lines.map((l) => (visibleWidth(l) > width ? truncateToWidth(l, width, "...") : l));
		}
		return lines;
	};

	ToolExecutionComponent.prototype.render = function (width: number): string[] {
		if ((this as any).hideComponent) return [];

		const theme = getActiveTheme();
		const status: ToolStatus = (this as any).isPartial
			? "running"
			: (this as any).result?.isError
				? "error"
				: "success";
		const isLast = isLastToolInSequence(this);
		const hasTextBefore = precedingHasTextDelta(this);
		const isRtk = Boolean((this as any).result?.details?.rtk || (this as any).args?._rtk);

		let lines: string[];
		if ((this as any).expanded) {
			lines = formatExpandedLines(
				(this as any).toolName,
				(this as any).args,
				(this as any).result,
				(this as any).isPartial,
				isLast,
				theme,
				(this as any).cwd,
				width,
				isRtk,
			);
			if (hasTextBefore) {
				lines.unshift("");
			}
			lines.push("");
		} else {
			const line = formatCollapsedLine(
				(this as any).toolName,
				(this as any).args,
				status,
				isLast,
				theme,
				(this as any).cwd,
				width,
				isRtk,
			);
			lines = hasTextBefore ? ["", line] : [line];
		}

		const imageComponents = (this as any).imageComponents;
		if (Array.isArray(imageComponents)) {
			for (const img of imageComponents) {
				lines.push(...img.render(width));
			}
		}

		if (width > 0) {
			return lines.map((l) => (visibleWidth(l) > width ? truncateToWidth(l, width, "...") : l));
		}
		return lines;
	};

	CompactionSummaryMessageComponent.prototype.render = function (width: number): string[] {
		const theme = getActiveTheme();
		const mdTheme = (this as any).markdownTheme ?? getMarkdownTheme();
		const summary = (this as any).message?.summary;
		const expanded = Boolean((this as any).expanded);
		return formatCompactionSummary("Conversation compacted", summary, expanded, width, theme, mdTheme);
	};

	BranchSummaryMessageComponent.prototype.render = function (width: number): string[] {
		const theme = getActiveTheme();
		const mdTheme = (this as any).markdownTheme ?? getMarkdownTheme();
		const summary = (this as any).message?.summary;
		const expanded = Boolean((this as any).expanded);
		return formatCompactionSummary("Branch summary", summary, expanded, width, theme, mdTheme);
	};

	const origUserMessageRender = UserMessageComponent.prototype.render;
	const origUserMessageInvalidate = UserMessageComponent.prototype.invalidate;

	UserMessageComponent.prototype.invalidate = function () {
		userMessageRenderCache.delete(this);
		if (typeof origUserMessageInvalidate === "function") {
			return origUserMessageInvalidate.call(this);
		}
	};

	// Suppress shortcut conflict warnings from our own package. These are
	// informational — the extension override still wins — and the user has
	// intentionally overridden the built-in keybindings.
	const origGetShortcutDiagnostics = ExtensionRunner.prototype.getShortcutDiagnostics;
	ExtensionRunner.prototype.getShortcutDiagnostics = function () {
		const diagnostics = origGetShortcutDiagnostics.call(this);
		return diagnostics.filter((d: { message?: string }) => !d.message?.includes("Using "));
	};

	UserMessageComponent.prototype.render = function (width: number): string[] {
		const text = (this as any).text;
		if (typeof text !== "string") {
			return origUserMessageRender.call(this, width);
		}

		const theme = getActiveTheme();
		const cached = userMessageRenderCache.get(this);
		if (cached && cached.text === text && cached.width === width && cached.theme === theme) {
			return cached.renderedLines;
		}

		try {
			const childMarkdown = (this as any).children?.[0]?.children?.[0];
			const mdTheme = makeMarkdownTheme(theme);
			const defaultTextStyle = {
				color: (content: string) => theme.fg("userMessageText", content),
			};
			const options = childMarkdown?.options;

			const lines = formatUserMessage(text, width, theme, mdTheme, defaultTextStyle, options);

			userMessageRenderCache.set(this, {
				text,
				width,
				theme,
				renderedLines: lines,
			});

			return lines;
		} catch {
			return origUserMessageRender.call(this, width);
		}
	};
}
