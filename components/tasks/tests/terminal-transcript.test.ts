import { describe, expect, it } from "vitest";
import { TerminalTranscript, type TranscriptLine } from "../src/terminal-transcript.js";

function render(chunks: string[], rows = 24): { plain: string; styled: string } {
	const lines: TranscriptLine[] = [];
	const transcript = new TerminalTranscript(rows, (line) => lines.push(line));
	for (const chunk of chunks) transcript.write(chunk);
	transcript.finish();
	lines.push(...transcript.screenLines());
	return { plain: lines.map((line) => line.plain).join("\n"), styled: lines.map((line) => line.styled).join("\n") };
}

describe("TerminalTranscript", () => {
	it("keeps text, line breaks, and a missing final line break as written", () => {
		expect(render(["one\ntwo\n"]).plain).toBe("one\ntwo\n");
		expect(render(["one\r\ntwo"]).plain).toBe("one\ntwo");
		expect(render(["a\n\n\nb\n"]).plain).toBe("a\n\n\nb\n");
		expect(render([""]).plain).toBe("");
	});

	it("keeps SGR styles per line and closes them at each line end", () => {
		const { plain, styled } = render(["\x1b[1;32mgreen\nstill green\x1b[0m plain\n"]);
		expect(plain).toBe("green\nstill green plain\n");
		expect(styled).toBe("\x1b[1;32mgreen\x1b[0m\n\x1b[1;32mstill green\x1b[0m plain\n");
		expect(render(["\x1b[31mred\x1b[m \x1b[0;34mblue\x1b[0m\n"]).styled).toBe(
			"\x1b[31mred\x1b[0m \x1b[34mblue\x1b[0m\n",
		);
	});

	it("applies carriage returns, backspaces, and erasures the way a terminal shows them", () => {
		expect(render(["10%\r50%\r100%\n"]).plain).toBe("100%\n");
		expect(render(["abcdef\rXY\n"]).plain).toBe("XYcdef\n");
		expect(render(["downloading 3/9\r\x1b[Kdone\n"]).plain).toBe("done\n");
		expect(render(["ab\bX\n"]).plain).toBe("aX\n");
		expect(render(["status: working\x1b[7D\x1b[Kdone\n"]).plain).toBe("status: done\n");
	});

	it("redraws a multi-line progress block in place instead of keeping every frame", () => {
		const frame = (a: number, b: number) => `fetch ${a}%\x1b[K\nbuild ${b}%\x1b[K\n`;
		const { plain } = render([frame(10, 0), "\x1b[2A", frame(60, 20), "\x1b[2A", frame(100, 100), "ok\n"]);
		expect(plain).toBe("fetch 100%\nbuild 100%\nok\n");
	});

	it("finalizes lines that scroll above the screen, so later cursor movement cannot change them", () => {
		const { plain } = render(["1\n2\n3\n4\n", "\x1b[3A\x1b[2Kx\n"], 2);
		expect(plain).toBe("1\n2\n3\nx\n");
	});

	it("drops other control sequences and alternate-screen content", () => {
		expect(render(["\x1b]0;title\x07\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\\n"]).plain).toBe("link\n");
		expect(render(["\x1b[?25lhidden cursor\x1b[?25h\x1b(B\x1b=\n"]).plain).toBe("hidden cursor\n");
		expect(render(["before\n\x1b[?1049h\x1b[H\x1b[2Jpager page\x1b[?1049lafter\n"]).plain).toBe("before\nafter\n");
		expect(render(["bell\x07 null\x00 del\x7f\n"]).plain).toBe("bell null del\n");
	});

	it("keeps what a cleared screen showed", () => {
		expect(render(["old\n\x1b[H\x1b[2Jnew\n"]).plain).toBe("old\nnew\n");
	});

	it("reassembles escape sequences and surrogate pairs split across writes", () => {
		expect(render(["\x1b", "[3", "2mok\x1b[", "0m\n"]).styled).toBe("\x1b[32mok\x1b[0m\n");
		expect(render(["\x1b]0;ti", "tle\x07x\n"]).plain).toBe("x\n");
		expect(render(["\ud83d", "\ude00\n"]).plain).toBe("\ud83d\ude00\n");
	});

	it("restores a saved cursor position", () => {
		expect(render(["count: \x1b7  1\x1b8  2\x1b8  3\n"]).plain).toBe("count:   3\n");
		expect(render(["count: \x1b[s1\x1b[u2\n"]).plain).toBe("count: 2\n");
	});
});
