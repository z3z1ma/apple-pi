import { Theme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { formatCollapsedLine, formatExpandedLines } from "./formatters.js";
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

export function isLastToolInSequence(component: ToolExecutionComponent): boolean {
	const parent = (component as any).parentContainer;
	if (!parent || !Array.isArray(parent.children)) return true;
	const children: any[] = parent.children;
	const index = children.indexOf(component);
	if (index === -1) return true;

	for (let i = index + 1; i < children.length; i++) {
		const next = children[i];
		if (next instanceof ToolExecutionComponent) {
			return false;
		}
		if (next?.constructor?.name === "Spacer") {
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
		if (prev?.constructor?.name === "Spacer") continue;
		return !(prev instanceof ToolExecutionComponent);
	}
	return false;
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

	ToolExecutionComponent.prototype.render = function (width: number): string[] {
		if ((this as any).hideComponent) return [];

		const theme = getActiveTheme();
		const status: ToolStatus = (this as any).isPartial
			? "running"
			: (this as any).result?.isError
				? "error"
				: "success";
		const isLast = isLastToolInSequence(this);
		const isFirst = isFirstToolInSequence(this);

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
			);
			lines = isFirst ? ["", line] : [line];
		}

		const imageComponents = (this as any).imageComponents;
		if (Array.isArray(imageComponents)) {
			for (const img of imageComponents) {
				lines.push(...img.render(width));
			}
		}

		return lines;
	};
}
