import { expect, test } from "vitest";
import { lineReader } from "../src/protocol.js";

test("lineReader holds partial messages until a newline and drains complete messages in order", () => {
	const messages: unknown[] = [];
	const read = lineReader((line) => messages.push(JSON.parse(line)));
	read(Buffer.from('{"type":"heart'));
	expect(messages).toEqual([]);
	read('beat"}\n{"type":"run"');
	expect(messages).toEqual([{ type: "heartbeat" }]);
	read(Buffer.from(',"run":"idle"}\n{"type":"shutdown","reason":"quit"}\n{"type":"run","run":"thinking"'));
	const completed = [{ type: "heartbeat" }, { type: "run", run: "idle" }, { type: "shutdown", reason: "quit" }];
	expect(messages).toEqual(completed);
	read("}\n");
	expect(messages).toEqual([...completed, { type: "run", run: "thinking" }]);
});

test("lineReader accepts JSON whitespace and ignores blank lines", () => {
	const messages: unknown[] = [];
	const read = lineReader((line) => messages.push(JSON.parse(line)));
	read('\n \t\n {"type":"heartbeat"} \n\n');
	expect(messages).toEqual([{ type: "heartbeat" }]);
});
