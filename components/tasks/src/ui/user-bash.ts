import { BashExecutionComponent, truncateTail, truncateToVisualLines } from "@earendil-works/pi-coding-agent";
import { type Container, Text } from "@earendil-works/pi-tui";

const PATCH = Symbol.for("apple_pi.user_bash_display");
const PREVIEW_LINES = 20;

interface BashDisplay {
	outputLines: string[];
	contentContainer: Container;
	expanded: boolean;
	outputPad: number;
	updateDisplay(): void;
}

interface DisplayState {
	chunk?: string;
	lines: WeakMap<BashExecutionComponent, string[]>;
}

export function withUserBashStyle(styled: string, emitPlain: () => void): void {
	const prototype = BashExecutionComponent.prototype;
	const patched = prototype as typeof prototype & { [PATCH]?: DisplayState };
	let state = patched[PATCH];
	if (!state) {
		state = { lines: new WeakMap() };
		patched[PATCH] = state;
		installDisplayPatch(state);
	}
	const previous = state.chunk;
	state.chunk = styled;
	try {
		emitPlain();
	} finally {
		state.chunk = previous;
	}
}

function installDisplayPatch(state: DisplayState): void {
	const prototype = BashExecutionComponent.prototype;
	const append = prototype.appendOutput;
	const update = (prototype as unknown as BashDisplay).updateDisplay;
	prototype.appendOutput = function (chunk) {
		const display = this as unknown as BashDisplay;
		if (state.chunk !== undefined || state.lines.has(this)) {
			const lines = state.lines.get(this) ?? [...display.outputLines];
			const added = (state.chunk ?? chunk).split("\n");
			if (lines.length) lines[lines.length - 1] += added.shift() ?? "";
			lines.push(...added);
			state.lines.set(this, lines);
		}
		append.call(this, chunk);
	};
	(prototype as unknown as BashDisplay).updateDisplay = function () {
		update.call(this);
		const styled = state.lines.get(this as unknown as BashExecutionComponent);
		if (!styled) return;
		const tail = truncateTail(this.outputLines.join("\n"));
		if (!tail.content) return;
		const kept = tail.content.split("\n").length;
		const end = styled.length - (tail.truncated && this.outputLines.at(-1) === "" ? 1 : 0);
		const lines = styled.slice(Math.max(0, end - kept), end);
		if (tail.lastLinePartial) lines[0] = tail.content.split("\n")[0] ?? "";
		const text = `\n${(this.expanded ? lines : lines.slice(-PREVIEW_LINES)).join("\n")}`;
		const expanded = this.expanded;
		const pad = this.outputPad;
		this.contentContainer.children[1] = expanded
			? new Text(text, pad, 0)
			: {
					render: (width) => truncateToVisualLines(text, PREVIEW_LINES, width, pad).visualLines,
					invalidate() {},
				};
	};
}
