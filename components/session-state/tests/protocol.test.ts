import { expect, test } from "vitest";
import { lineReader } from "../src/protocol.js";

test("lineReader holds partial messages until a newline and drains complete messages in order", () => {
	const lines: string[] = [];
	const read = lineReader((line) => lines.push(line));
	read(Buffer.from('{"type":"heart'));
	expect(lines).toEqual([]);
	read('beat"}\n{"type":"run"');
	expect(lines).toEqual(['{"type":"heartbeat"}']);
	read(Buffer.from(',"run":"idle"}\n{"type":"shutdown"}\npartial'));
	expect(lines).toEqual(['{"type":"heartbeat"}', '{"type":"run","run":"idle"}', '{"type":"shutdown"}']);
	read("\n");
	expect(lines.at(-1)).toBe("partial");
});

test("lineReader skips blank lines and preserves nonempty payload whitespace", () => {
	const lines: string[] = [];
	const read = lineReader((line) => lines.push(line));
	read('\n \t\n {"type":"heartbeat"} \n\n');
	expect(lines).toEqual([' {"type":"heartbeat"} ']);
});
