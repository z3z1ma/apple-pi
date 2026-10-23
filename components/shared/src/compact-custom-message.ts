import { CustomMessageComponent } from "@earendil-works/pi-coding-agent";

const COMPACT_TYPES = Symbol.for("apple-pi.compact-custom-messages");

type Patched = typeof CustomMessageComponent.prototype & { [COMPACT_TYPES]?: Set<string> };

/**
 * Render custom messages of `customType` without the blank lines Pi puts around every custom message, so a one-line
 * renderer sits in the stream like a tool call. Pi adds the spacer outside the registered renderer, so the
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
			const { message } = this as unknown as { message: { customType: string } };
			if (!(prototype as Patched)[COMPACT_TYPES]?.has(message.customType)) return lines;
			while (lines.length && !lines[0]?.trim()) lines.shift();
			while (lines.length && !lines.at(-1)?.trim()) lines.pop();
			return lines.map((line) => line.trimEnd());
		};
	}
	types.add(customType);
}
