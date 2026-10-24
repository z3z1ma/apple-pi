import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createEditToolDefinition,
	getMarkdownTheme,
	highlightCode,
	initTheme,
	Theme,
	ToolExecutionComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
	KeybindingsManager,
	stripTerminalSequences,
	type TUI,
	TUI_KEYBINDINGS,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getActiveTheme, installTerseToolRenderer } from "../src/patch.js";
import { type ToolInspection, ToolViewer } from "../src/tool-viewer.js";

beforeAll(() => {
	initTheme();
	installTerseToolRenderer();
});
const viewers: ToolViewer[] = [];
afterEach(() => {
	for (const viewer of viewers.splice(0)) viewer.dispose();
});
const plain = (lines: string[]) => lines.map(stripTerminalSequences).join("\n");
const source = 'const greeting: string = "hello"; // a message';

function expanded(
	tool: string,
	args: unknown,
	text: string,
	details?: unknown,
	partial = false,
	isError = false,
	width = 160,
) {
	return renderTool(tool, args, { content: [{ type: "text", text }], details, isError }, partial, width);
}

function renderTool(
	tool: string,
	args: unknown,
	result: NonNullable<ToolInspection["result"]>,
	partial = false,
	width = 160,
) {
	const component = new ToolExecutionComponent(
		tool,
		"parity",
		args,
		{},
		undefined,
		{ requestRender() {} } as any,
		process.cwd(),
	);
	component.updateResult({ ...result, content: result.content ?? [], isError: result.isError ?? false }, partial);
	component.setExpanded(true);
	return component.render(width);
}

function viewer(inspection: Partial<ToolInspection>, output = true, width = 160) {
	const component = new ToolViewer(
		{ terminal: { rows: 60 }, requestRender() {} } as unknown as TUI,
		getActiveTheme(),
		new KeybindingsManager(TUI_KEYBINDINGS, {}),
		() => {},
		() => ({ toolName: "read", toolCallId: "parity", args: { path: "example.ts" }, isPartial: false, ...inspection }),
	);
	viewers.push(component);
	if (output) component.switchTab("output");
	return component.render(width);
}

function expectBoldNameChange(lines: string[], lineNumber: number) {
	for (const [sign, color, word] of [
		["-", "toolDiffRemoved", "old"],
		["+", "toolDiffAdded", "new"],
	] as const) {
		const row = lines.find((line) =>
			stripTerminalSequences(line).includes(`${sign}${lineNumber} const name = "${word}";`),
		);
		expect(row).toBeDefined();
		expect(row).toContain(getActiveTheme().fg(color, `${sign}${lineNumber} const name = "\x1b[1m${word}\x1b[22m";`));
		expect(row).not.toMatch(/\x1b\[(?:7|27|4\d|10[0-7])(?:[;:][\d;:]*)?m/);
	}
}

describe("native Pi rendering parity", () => {
	it.each([
		["example.ts", "typescript", source],
		["example.py", "python", 'def greet():\n\treturn "hello"'],
		["example.json", "json", '{"hello": true}'],
		["example.yaml", "yaml", "hello: true"],
		["example.md", "markdown", "# Hello\n**world**"],
	])("uses native highlighting for %s in both read views", (path, language, text) => {
		const expected = highlightCode(text.replace(/\t/g, "   "), language);
		const args = Object.freeze({ path });
		const result = Object.freeze({ content: [Object.freeze({ type: "text", text })] });
		const transcript = expanded("read", args, text).join("\n");
		const inspector = viewer({ args, result }).join("\n");
		for (const line of expected.filter(Boolean)) {
			expect(transcript).toContain(line);
			expect(inspector).toContain(line);
		}
		expect(result.content[0].text).toBe(text);
	});

	it("keeps unknown file types and read errors in the ordinary output and error colors", () => {
		const args = { path: "example.unknown" };
		for (const output of [
			expanded("read", args, source),
			viewer({ args, result: { content: [{ type: "text", text: source }] } }),
		]) {
			expect(output.join("\n")).toContain(getActiveTheme().fg("toolOutput", source));
		}
		const failure = expanded("read", { path: "example.ts" }, source, undefined, false, true);
		expect(plain(failure)).toContain(source);
		expect(failure.join("\n")).toContain(getActiveTheme().fg("error", source));
		const output = viewer({ result: { content: [{ type: "text", text: source }], isError: true } });
		expect(plain(output)).toContain(source);
		expect(output.join("\n")).toContain(getActiveTheme().fg("error", source));
	});

	it("highlights Write content rather than its success message, including while running", () => {
		const args = { path: "example.ts", content: source };
		for (const partial of [false, true]) {
			const output = expanded("write", args, "Successfully wrote file", undefined, partial);
			expect(output.join("\n")).toContain(highlightCode(source, "typescript")[0]);
		}
		expect(viewer({ toolName: "write", args }, false).join("\n")).toContain(highlightCode(source, "typescript")[0]);
	});

	it("highlights Edit source arguments and structured inspector data", () => {
		expect(
			viewer({ toolName: "edit", args: { path: "example.ts", oldText: source, newText: source } }, false).join("\n"),
		).toContain(highlightCode(source, "typescript")[0]);
		const batch = viewer(
			{ toolName: "edit", args: { path: "example.ts", edits: [{ oldText: source, newText: source }] } },
			false,
		);
		expect(batch.join("\n")).toContain(highlightCode(source, "typescript")[0]);
		expect(plain(batch)).toContain("Edit 1");
		const data = { enabled: true };
		const expected = highlightCode(JSON.stringify(data, null, 2), "json");
		const input = viewer({ args: { options: data } }, false).join("\n");
		const output = viewer({ result: { details: data } }).join("\n");
		for (const line of expected) {
			expect(input).toContain(line);
			expect(output).toContain(line);
		}
	});

	it("uses bold changed words without reverse video or backgrounds in both diff views", () => {
		const inverse = vi.spyOn(Theme.prototype, "inverse").mockImplementation((text) => `\x1b[7m${text}\x1b[27m`);
		try {
			const diff = '-12 const name = "old";\n+12 const name = "new";';
			const transcript = expanded("edit", { path: "example.ts" }, "Edited", { diff });
			const inspector = viewer({ toolName: "edit", result: { details: { diff } } });
			for (const output of [transcript, inspector]) expectBoldNameChange(output, 12);
		} finally {
			inverse.mockRestore();
		}
	});

	it("uses the same bold changed words in the pending Edit preview", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "render-parity-"));
		const inverse = vi.spyOn(Theme.prototype, "inverse").mockImplementation((text) => `\x1b[7m${text}\x1b[27m`);
		try {
			await writeFile(join(cwd, "example.ts"), 'const name = "old";\n');
			const args = { path: "example.ts", edits: [{ oldText: '"old"', newText: '"new"' }] };
			const tool = new ToolExecutionComponent(
				"edit",
				"preview",
				args,
				{},
				createEditToolDefinition(cwd),
				{ requestRender() {} } as any,
				cwd,
			);
			tool.setArgsComplete();
			tool.setExpanded(true);
			await vi.waitFor(() => expectBoldNameChange(tool.render(160), 1));
		} finally {
			inverse.mockRestore();
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("retains coloring for unnumbered patches from other tools", () => {
		const text = "-old line\n+new line";
		const output = viewer({ toolName: "custom", result: { details: { patch: text } } }).join("\n");
		expect(output).toContain(getActiveTheme().fg("toolDiffRemoved", "-old line"));
		expect(output).toContain(getActiveTheme().fg("toolDiffAdded", "+new line"));
	});

	it("retains every text block and applies the native output and error colors", () => {
		const theme = getActiveTheme();
		for (const isError of [false, true]) {
			const output = renderTool(
				"bash",
				{},
				{
					content: [
						{ type: "text", text: "first" },
						{ type: "text", text: "second" },
					],
					isError,
				},
			);
			for (const text of ["first", "second"])
				expect(output.join("\n")).toContain(theme.fg(isError ? "error" : "toolOutput", text));
		}
	});

	it.each([
		{ tool: "read", details: { truncation: { truncated: true } }, warnings: ["Output truncated"] },
		{
			tool: "grep",
			details: { matchLimitReached: 100, linesTruncated: true },
			warnings: ["100 matches limit", "Some lines truncated"],
		},
		{ tool: "find", details: { resultLimitReached: 200 }, warnings: ["200 results limit"] },
		{ tool: "ls", details: { entryLimitReached: 300 }, warnings: ["300 entries limit"] },
		{ tool: "bash", details: { fullOutputPath: "/tmp/output.log" }, warnings: ["Full output: /tmp/output.log"] },
	])("shows $tool warnings even when the transcript preview hides the output tail", ({ tool, details, warnings }) => {
		const theme = getActiveTheme();
		const text = Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n");
		const transcript = expanded(tool, {}, text, details).join("\n");
		const inspector = viewer({ toolName: tool, result: { content: [{ type: "text", text }], details } }).join("\n");
		for (const warning of warnings) {
			const expected = theme.fg("warning", `[${warning}]`);
			expect(transcript).toContain(expected);
			expect(inspector).toContain(expected);
		}
	});

	it.each(["sum([1, 2, 3])", 'for name in ["Ada"]:\n    print(name)'])(
		"highlights pi_exec code as Python: %s",
		(code) => {
			const args = Object.freeze({ code });
			const output = viewer({ toolName: "pi_exec", args }, false).join("\n");
			for (const line of highlightCode(code, "python")) expect(output).toContain(line);
			expect(args.code).toBe(code);
		},
	);

	it.each([false, true])("preserves command ANSI styling across output lines, error=%s", (isError) => {
		const text = "\x1b[1;38;2;140;90;220mfirst\nsecond\x1b[0m plain";
		const expected = wrapTextWithAnsi(text, 160);
		const transcript = expanded("bash", {}, text, undefined, false, isError).join("\n");
		const inspector = viewer({ toolName: "bash", result: { content: [{ type: "text", text }], isError } }).join("\n");
		for (const line of expected) {
			expect(transcript).toContain(line);
			expect(inspector).toContain(line);
		}
	});

	it.each([false, true])("shows Bash's styled output while the model's text stays plain, error=%s", (isError) => {
		const text = "green\n\nCommand exited with code 1";
		const details = { styledOutput: "\x1b[32mgreen\x1b[0m\n\nCommand exited with code 1" };
		const transcript = expanded("bash", {}, text, details, false, isError).join("\n");
		const inspector = viewer({
			toolName: "bash",
			result: { content: [{ type: "text", text }], details, isError },
		}).join("\n");
		for (const output of [transcript, inspector]) {
			expect(output).toContain("\x1b[32mgreen\x1b[0m");
			expect(stripTerminalSequences(output).match(/green/g)).toHaveLength(1);
		}
	});

	it("preserves code-fence colors and Markdown transforms in user messages", () => {
		const text = `before\n\n\`\`\`typescript\n${source}\n\`\`\``;
		const component = new UserMessageComponent(text, undefined, 1, [(markdown) => markdown.replace("before", "after")]);
		const output = component.render(160).join("\n");
		expect(stripTerminalSequences(output)).toContain("after");
		expect(stripTerminalSequences(output)).not.toContain("before");
		expect(output).toContain(highlightCode(source, "typescript")[0]);
		const custom = new UserMessageComponent(text, {
			...getMarkdownTheme(),
			highlightCode: () => ["CUSTOM CODE STYLE"],
		});
		expect(plain(custom.render(160))).toContain("CUSTOM CODE STYLE");
	});

	it("keeps colored content within narrow terminal bounds and preserves read notices", () => {
		const text = `${source}\n\n[Showing lines 1-1 of 2. Use offset=2 to continue.]`;
		expect(plain(expanded("read", { path: "example.ts" }, text))).toContain("[Showing lines 1-1 of 2.");
		for (const width of [24, 50]) {
			for (const line of expanded("read", { path: "example.ts" }, text, undefined, false, false, width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
			for (const line of viewer({ result: { content: [{ type: "text", text }] } }, true, width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});
});
