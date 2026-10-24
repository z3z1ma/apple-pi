export interface TranscriptLine {
	/** Text with SGR color and style sequences only; each line closes its own styling. */
	styled: string;
	plain: string;
}

class Line {
	chars: string[] = [];
	styles: string[] = [];

	put(col: number, char: string, style: string): void {
		while (this.chars.length < col) {
			this.chars.push(" ");
			this.styles.push("");
		}
		this.chars[col] = char;
		this.styles[col] = style;
	}

	render(): TranscriptLine {
		const plain = this.chars.join("");
		if (this.styles.every((style) => style === "")) return { styled: plain, plain };
		let styled = "";
		let current = "";
		for (let i = 0; i < this.chars.length; i++) {
			const style = this.styles[i] ?? "";
			if (style !== current) {
				styled += (current ? "\x1b[0m" : "") + style;
				current = style;
			}
			styled += this.chars[i];
		}
		return { styled: current ? `${styled}\x1b[0m` : styled, plain };
	}
}

interface Screen {
	lines: Line[];
	row: number;
	col: number;
	saved?: { row: number; col: number };
}

const ALT_SCREEN_MODES = new Set(["?47", "?1047", "?1049"]);

/**
 * Turns the output a program writes to a terminal into transcript lines. The last `rows` lines stay
 * editable, as on a terminal screen, so carriage returns, erasures, and cursor movement redraw them
 * (progress bars) instead of adding a line per frame. Lines that scroll above the screen are final.
 * SGR colors and styles are kept; every other control sequence is applied or dropped.
 */
export class TerminalTranscript {
	private main: Screen = { lines: [new Line()], row: 0, col: 0 };
	private alternate?: Screen;
	private style = "";
	private pending = "";

	constructor(
		private readonly rows: number,
		private readonly onFinalLine: (line: TranscriptLine) => void,
	) {}

	write(text: string): void {
		const input = this.pending + text;
		this.pending = "";
		let i = 0;
		while (i < input.length) {
			const char = input[i] as string;
			const code = char.charCodeAt(0);
			if (char === "\x1b") {
				const consumed = this.escape(input, i);
				if (consumed === 0) {
					this.pending = input.slice(i);
					return;
				}
				i += consumed;
				continue;
			}
			if (code >= 0xd800 && code <= 0xdbff) {
				if (i + 1 >= input.length) {
					this.pending = char;
					return;
				}
				this.print(input.slice(i, i + 2));
				i += 2;
				continue;
			}
			if (char === "\n") this.lineFeed();
			else if (char === "\r") this.screen.col = 0;
			else if (char === "\b") this.screen.col = Math.max(0, this.screen.col - 1);
			else if (char === "\t" || !isControl(code)) this.print(char);
			i++;
		}
	}

	/**
	 * Lines still on screen, which later output can change. The last one has no line break yet; it is
	 * empty when the output so far ends with one.
	 */
	screenLines(): TranscriptLine[] {
		return this.screen.lines.map((line) => line.render());
	}

	/**
	 * Emits every line that ends with a line break as final and keeps the unterminated last line, which
	 * stays the only screen line. An unfinished escape sequence is dropped.
	 */
	finish(): void {
		this.pending = "";
		const lines = this.screen.lines;
		const last = lines.pop() as Line;
		for (const line of lines) this.onFinalLine(line.render());
		this.main = { lines: [last], row: 0, col: last.chars.length };
		this.alternate = undefined;
	}

	private get screen(): Screen {
		return this.alternate ?? this.main;
	}

	private print(char: string): void {
		const screen = this.screen;
		(screen.lines[screen.row] as Line).put(screen.col, char, this.style);
		screen.col++;
	}

	private lineFeed(): void {
		const screen = this.screen;
		screen.col = 0;
		this.moveToRow(screen.row + 1);
	}

	private moveToRow(row: number): void {
		const screen = this.screen;
		screen.row = Math.max(0, row);
		while (screen.lines.length <= screen.row) screen.lines.push(new Line());
		while (screen.lines.length > this.rows) {
			const line = screen.lines.shift() as Line;
			screen.row--;
			if (screen.saved) screen.saved.row--;
			if (!this.alternate) this.onFinalLine(line.render());
		}
	}

	/** Returns how many characters the sequence at `start` uses, or 0 when it is still incomplete. */
	private escape(input: string, start: number): number {
		const kind = input[start + 1];
		if (kind === undefined) return 0;
		if (kind === "[") {
			let end = start + 2;
			while (end < input.length && /[0-?]/.test(input[end] as string)) end++;
			while (end < input.length && /[ -/]/.test(input[end] as string)) end++;
			if (end >= input.length) return 0;
			this.controlSequence(input.slice(start + 2, end), input[end] as string);
			return end - start + 1;
		}
		if ("]P_^X".includes(kind)) {
			for (let end = start + 2; end < input.length; end++) {
				if (kind === "]" && input[end] === "\x07") return end - start + 1;
				if (input[end] === "\x1b") {
					if (end + 1 >= input.length) return 0;
					if (input[end + 1] === "\\") return end - start + 2;
				}
			}
			return 0;
		}
		if ("()*+-./#%".includes(kind)) return start + 2 < input.length ? 3 : 0;
		if (kind === "7") this.screen.saved = { row: this.screen.row, col: this.screen.col };
		else if (kind === "8") this.restoreCursor();
		return 2;
	}

	private controlSequence(params: string, final: string): void {
		const screen = this.screen;
		if (final === "m" && !/^[<=>?]/.test(params)) {
			this.setStyle(params);
			return;
		}
		if (params.startsWith("?")) {
			if (final === "h" || final === "l") {
				for (const mode of params.split(";")) {
					if (ALT_SCREEN_MODES.has(mode) || ALT_SCREEN_MODES.has(`?${mode}`)) this.setAlternate(final === "h");
				}
			}
			return;
		}
		if (/[<=>]/.test(params[0] ?? "")) return;
		const args = params.split(";").map((value) => Number.parseInt(value, 10));
		const count = Math.max(1, args[0] || 1);
		const line = screen.lines[screen.row] as Line;
		switch (final) {
			case "A":
				this.moveToRow(screen.row - count);
				break;
			case "B":
				this.moveToRow(Math.min(screen.row + count, this.rows - 1));
				break;
			case "C":
				screen.col += count;
				break;
			case "D":
				screen.col = Math.max(0, screen.col - count);
				break;
			case "E":
				screen.col = 0;
				this.moveToRow(Math.min(screen.row + count, this.rows - 1));
				break;
			case "F":
				screen.col = 0;
				this.moveToRow(screen.row - count);
				break;
			case "G":
			case "`":
				screen.col = count - 1;
				break;
			case "d":
				this.moveToRow(Math.min(count, this.rows) - 1);
				break;
			case "H":
			case "f":
				this.moveToRow(Math.min(count, this.rows) - 1);
				screen.col = Math.max(1, args[1] || 1) - 1;
				break;
			case "K":
				this.eraseInLine(line, args[0] || 0);
				break;
			case "J":
				this.eraseInDisplay(args[0] || 0);
				break;
			case "P":
				line.chars.splice(screen.col, count);
				line.styles.splice(screen.col, count);
				break;
			case "@":
				if (screen.col < line.chars.length) {
					line.chars.splice(screen.col, 0, ...Array(count).fill(" "));
					line.styles.splice(screen.col, 0, ...Array(count).fill(""));
				}
				break;
			case "X":
				for (let col = screen.col; col < Math.min(line.chars.length, screen.col + count); col++) line.put(col, " ", "");
				break;
			case "s":
				screen.saved = { row: screen.row, col: screen.col };
				break;
			case "u":
				this.restoreCursor();
				break;
		}
	}

	private setStyle(params: string): void {
		if (params === "" || params === "0") this.style = "";
		else if (params.startsWith("0;")) this.style = `\x1b[${params.slice(2)}m`;
		else this.style += `\x1b[${params}m`;
	}

	private setAlternate(enabled: boolean): void {
		if (enabled && !this.alternate) this.alternate = { lines: [new Line()], row: 0, col: 0 };
		else if (!enabled) this.alternate = undefined;
	}

	private restoreCursor(): void {
		const screen = this.screen;
		if (!screen.saved) return;
		screen.col = screen.saved.col;
		this.moveToRow(screen.saved.row);
	}

	private eraseInLine(line: Line, mode: number): void {
		const col = this.screen.col;
		if (mode === 0) {
			line.chars.length = Math.min(line.chars.length, col);
			line.styles.length = line.chars.length;
		} else if (mode === 1) {
			for (let i = 0; i <= Math.min(col, line.chars.length - 1); i++) line.put(i, " ", "");
		} else {
			line.chars = [];
			line.styles = [];
		}
	}

	private eraseInDisplay(mode: number): void {
		const screen = this.screen;
		const line = screen.lines[screen.row] as Line;
		if (mode === 0) {
			this.eraseInLine(line, 0);
			screen.lines.length = screen.row + 1;
		} else if (mode === 1) {
			for (let row = 0; row < screen.row; row++) screen.lines[row] = new Line();
			this.eraseInLine(line, 1);
		} else {
			// A cleared screen keeps what it showed in the transcript, as terminal scrollback does.
			if (!this.alternate) {
				for (const kept of screen.lines) if (kept.chars.length > 0) this.onFinalLine(kept.render());
			}
			screen.lines = [new Line()];
			screen.row = 0;
			screen.saved = undefined;
		}
	}
}

function isControl(code: number): boolean {
	return code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f) || (code >= 0xfff9 && code <= 0xfffb);
}
