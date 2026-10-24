import { AssistantMessageComponent, CustomMessageComponent } from "@earendil-works/pi-coding-agent";
import type { Container } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";

const COMPACT_TYPES = Symbol.for("apple-pi.compact-custom-messages");

type Patched = typeof CustomMessageComponent.prototype & { [COMPACT_TYPES]?: Set<string> };

function followsAssistantProse(component: CustomMessageComponent, width: number): boolean {
	const { parentContainer } = component as CustomMessageComponent & { parentContainer?: Container };
	if (!parentContainer) return false;
	const siblings = parentContainer.children;
	for (let i = siblings.indexOf(component) - 1; i >= 0; i--) {
		const previous = siblings[i];
		if (!(previous instanceof AssistantMessageComponent)) return false;
		if (previous.render(width).some((line) => visibleWidth(line) > 0)) return true;
	}
	return false;
}

/**
 * Render custom messages of `customType` like tool calls: adjacent within a sequence, separated from assistant prose.
 * Pi adds the spacer outside the registered renderer, so the
 * component's own render is patched once per process; the patch leaves every other message as it is.
 */
export function renderInline(customType: string): void {
	const prototype = CustomMessageComponent.prototype as Patched;
	let types = prototype[COMPACT_TYPES];
	if (!types) {
		types = new Set();
		Object.defineProperty(prototype, COMPACT_TYPES, { value: types });
		const render = prototype.render;
		prototype.render = function (this: CustomMessageComponent, width: number): string[] {
			const lines = render.call(this, width);
			if (!rendersInline(this)) return lines;
			while (lines.length && !lines[0]?.trim()) lines.shift();
			while (lines.length && !lines.at(-1)?.trim()) lines.pop();
			if (lines.length && followsAssistantProse(this, width)) lines.unshift("");
			return lines.map((line) => line.trimEnd());
		};
	}
	types.add(customType);
}

/** Whether `component` is a custom message rendered inline, so the tool after it stays on the next line. */
export function rendersInline(component: unknown): boolean {
	if (!(component instanceof CustomMessageComponent)) return false;
	const { message } = component as unknown as { message?: { customType?: string } };
	return Boolean(
		message?.customType && (CustomMessageComponent.prototype as Patched)[COMPACT_TYPES]?.has(message.customType),
	);
}
