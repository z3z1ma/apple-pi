import { AssistantMessageComponent, Theme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Container, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatCollapsedLine, formatExpandedLines, formatThoughtHeader, formatThoughtSnippet } from "./formatters.js";
import type { ToolStatus } from "./types.js";

const PATCH_APPLIED = Symbol.for("apple_pi.terse_tools_patched");

let activeTheme: Theme | undefined;

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
		const hasStopError =
			msg.stopReason === "length" || (!hasTools && (msg.stopReason === "aborted" || msg.stopReason === "error"));
		if (hasTools && !hasText && !hasStopError) {
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

export function customizeThinkingDisplay(comp: AssistantMessageComponent): void {
	const msg = (comp as any).lastMessage;
	if (!msg || !Array.isArray(msg.content)) return;

	const hasTools = msg.content.some((c: any) => c.type === "toolCall");
	const hasText = msg.content.some((c: any) => c.type === "text" && c.text?.trim());
	const hasStopError =
		msg.stopReason === "length" || (!hasTools && (msg.stopReason === "aborted" || msg.stopReason === "error"));

	const container = (comp as any).contentContainer;
	if (!container || !Array.isArray(container.children)) return;

	// Intermediate tool-call turn: clear container so it renders 0 lines
	if (hasTools && !hasText && !hasStopError) {
		container.clear();
		return;
	}

	// Thinking display customization when hiddenThinkingBlock is active
	if ((comp as any).hideThinkingBlock) {
		const thinkingBlocks: string[] = [];
		for (const c of msg.content) {
			if (c.type === "thinking" && c.thinking?.trim()) {
				thinkingBlocks.push(c.thinking.trim());
			}
		}

		if (thinkingBlocks.length > 0) {
			const theme = getActiveTheme();
			const durationMs = (comp as any)._durationMs;
			const tokens = msg.usage?.outputTokens ?? msg.usage?.totalTokens;
			const header = formatThoughtHeader(durationMs, tokens, theme);
			const fullThinking = thinkingBlocks.join("\n\n");
			const snippet = formatThoughtSnippet(fullThinking, 80, theme);
			const cardText = snippet ? `${header}\n${snippet}` : header;

			for (const child of container.children) {
				if (typeof (child as any).setText === "function") {
					const textContent = (child as any).text ?? "";
					if (
						textContent.includes((comp as any).hiddenThinkingLabel ?? "Thinking...") ||
						textContent.includes("Thinking...") ||
						textContent.includes("▶ Thought")
					) {
						(child as any).setText(cardText);
					}
				}
			}
		}
	}
}

export function installTerseToolRenderer(): void {
	if ((ToolExecutionComponent as any)[PATCH_APPLIED]) {
		return;
	}
	(ToolExecutionComponent as any)[PATCH_APPLIED] = true;

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
		if (msg) {
			const hasTools = msg.content?.some((c: any) => c.type === "toolCall");
			const hasText = msg.content?.some((c: any) => c.type === "text" && c.text?.trim());
			const hasStopError =
				msg.stopReason === "length" || (!hasTools && (msg.stopReason === "aborted" || msg.stopReason === "error"));
			if (hasTools && !hasText && !hasStopError) {
				return [];
			}
		}
		const lines = origAssistantRender.call(this, width);
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
			);
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
			);
			lines = [line];
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
}
