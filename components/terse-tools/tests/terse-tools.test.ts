import { homedir } from "node:os";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import {
	formatCollapsedLine,
	formatExpandedLines,
	formatPath,
	formatStatusBullet,
	formatToolArgs,
	formatToolName,
	parseDiff,
} from "../src/formatters.js";
import { installTerseToolRenderer, isFirstToolInSequence, isLastToolInSequence, setActiveTheme } from "../src/patch.js";

const HOME = homedir();

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}

const testTheme = {
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
} as any;

describe("terse tool formatters", () => {
	it("formats tool names to PascalCase with known aliases", () => {
		expect(stripAnsi(formatToolName("bash", testTheme))).toBe("Bash");
		expect(stripAnsi(formatToolName("powershell", testTheme))).toBe("Bash");
		expect(stripAnsi(formatToolName("read", testTheme))).toBe("Read");
		expect(stripAnsi(formatToolName("edit", testTheme))).toBe("Edit");
		expect(stripAnsi(formatToolName("write", testTheme))).toBe("Write");
		expect(stripAnsi(formatToolName("grep", testTheme))).toBe("Search");
		expect(stripAnsi(formatToolName("find", testTheme))).toBe("Find");
		expect(stripAnsi(formatToolName("ls", testTheme))).toBe("Ls");
		expect(stripAnsi(formatToolName("task", testTheme))).toBe("ManageTask");
		expect(stripAnsi(formatToolName("manage_task", testTheme))).toBe("ManageTask");
		expect(stripAnsi(formatToolName("schedule", testTheme))).toBe("Schedule");
		expect(stripAnsi(formatToolName("pi_exec", testTheme))).toBe("Exec");
		expect(stripAnsi(formatToolName("ask_user_question", testTheme))).toBe("AskUserQuestion");
		expect(stripAnsi(formatToolName("slack_send_message", testTheme))).toBe("SlackSendMessage");
		expect(stripAnsi(formatToolName("custom-tool-name", testTheme))).toBe("CustomToolName");
	});

	it("formats status bullets with appropriate theme colors", () => {
		const runningBullet = formatStatusBullet("running", testTheme);
		expect(runningBullet).toContain("●");
		expect(runningBullet).toContain("\x1b[33m"); // yellow

		const successBullet = formatStatusBullet("success", testTheme);
		expect(successBullet).toContain("●");
		expect(successBullet).toContain("\x1b[32m"); // green

		const errorBullet = formatStatusBullet("error", testTheme);
		expect(errorBullet).toContain("●");
		expect(errorBullet).toContain("\x1b[31m"); // red
	});

	it("formats home paths replacing $HOME with ~", () => {
		expect(formatPath(`${HOME}/code/project/file.ts`)).toBe("~/code/project/file.ts");
		expect(formatPath(HOME)).toBe("~");
		expect(formatPath("/tmp/some-file.txt")).toBe("/tmp/some-file.txt");
		expect(formatPath("")).toBe("");
	});

	it("formats arguments concisely for each tool type", () => {
		expect(formatToolArgs("bash", { command: "git status --short --branch\n" })).toBe("git status --short --branch");

		expect(formatToolArgs("read", { path: `${HOME}/test.ts` })).toBe("~/test.ts");
		expect(formatToolArgs("read", { path: `${HOME}/test.ts`, offset: 10, limit: 20 })).toBe("~/test.ts:10-29");

		expect(formatToolArgs("edit", { path: `${HOME}/test.ts` })).toBe("~/test.ts");
		expect(formatToolArgs("write", { file_path: `${HOME}/new.ts` })).toBe("~/new.ts");

		expect(formatToolArgs("grep", { pattern: "SearchPattern", path: "src" })).toBe("SearchPattern in src");
		expect(formatToolArgs("grep", { pattern: "SearchPattern", path: "." })).toBe("SearchPattern");

		expect(formatToolArgs("find", { pattern: "*.ts" })).toBe("*.ts");
		expect(formatToolArgs("ls", { path: "components" })).toBe("components");

		expect(formatToolArgs("task", { action: "status", task_id: "task-54" })).toBe("status task-54");
		expect(formatToolArgs("manage_task", { action: "kill", taskId: "task-58" })).toBe("kill task-58");

		expect(
			formatToolArgs("schedule", {
				DurationSeconds: 10,
				Prompt: "Wait for test suite to finish",
			}),
		).toBe("10s: Wait for test suite to finish");

		expect(formatToolArgs("pi_exec", { title: "Trace prior cron and sensor design" })).toBe(
			"Trace prior cron and sensor design",
		);
		expect(
			formatToolArgs("ask_user_question", {
				questions: [{ question: "Do you want to proceed?" }],
			}),
		).toBe("Do you want to proceed?");

		expect(formatToolArgs("custom_tool", { query: "hello world" })).toBe("hello world");
		expect(formatToolArgs("custom_tool", { foo: "bar", count: 42 })).toBe("foo: bar, count: 42");
	});

	it("parses diff text counting added and removed lines", () => {
		const diff = " 10 context\n+11 added line\n-12 removed line\n+13 another added";
		const parsed = parseDiff(diff);
		expect(parsed.added).toBe(2);
		expect(parsed.removed).toBe(1);
		expect(parsed.lines).toHaveLength(4);
	});

	it("formats collapsed line and adds ctrl+o hint only to the last tool", () => {
		const middleLine = formatCollapsedLine("bash", { command: "git status" }, "success", false, testTheme);
		expect(middleLine).toContain("●");
		expect(stripAnsi(middleLine)).toBe("● Bash(git status)");
		expect(middleLine).not.toContain("ctrl+o");

		const lastLine = formatCollapsedLine("bash", { command: "npm test" }, "success", true, testTheme);
		expect(lastLine).toContain("●");
		expect(stripAnsi(lastLine)).toBe("● Bash(npm test) (ctrl+o to expand)");
	});

	it("formats expanded lines with Antigravity layout and symbols", () => {
		const readExpanded = formatExpandedLines(
			"read",
			{ path: `${HOME}/file.txt` },
			{ content: [{ type: "text", text: "line 1\nline 2\nline 3" }] },
			false,
			true,
			testTheme,
		);
		expect(stripAnsi(readExpanded[0])).toBe("● Read(~/file.txt)");
		expect(stripAnsi(readExpanded[1])).toBe("  └ Read 3 lines");
		expect(stripAnsi(readExpanded[2])).toBe("    line 1");
		expect(readExpanded[readExpanded.length - 1]).toContain("(ctrl+o to collapse)");

		const editDiff = " 1\n+2 added\n-3 removed";
		const editExpanded = formatExpandedLines(
			"edit",
			{ path: `${HOME}/file.txt` },
			{
				content: [{ type: "text", text: "Edited file" }],
				details: { diff: editDiff },
			},
			false,
			false,
			testTheme,
		);
		expect(stripAnsi(editExpanded[0])).toBe("● Edit(~/file.txt)");
		expect(editExpanded[1]).toContain("+1");
		expect(editExpanded[1]).toContain("-1 lines");

		const errorExpanded = formatExpandedLines(
			"bash",
			{ command: "bad-cmd" },
			{
				content: [{ type: "text", text: "command not found: bad-cmd" }],
				isError: true,
			},
			false,
			true,
			testTheme,
		);
		expect(stripAnsi(errorExpanded[0])).toBe("● Bash(bad-cmd)");
		expect(stripAnsi(errorExpanded[1])).toBe("  └ command not found: bad-cmd (ctrl+o to collapse)");
		expect(errorExpanded[errorExpanded.length - 1]).toContain("(ctrl+o to collapse)");
	});
});

describe("terse tool renderer integration with ToolExecutionComponent", () => {
	beforeAll(() => {
		initTheme();
		installTerseToolRenderer();
		setActiveTheme(testTheme);
	});

	it("renders multiple consecutive tools without blank lines between them", () => {
		const container = new Container();
		const t1 = new ToolExecutionComponent(
			"bash",
			"call_1",
			{ command: "git status" },
			{},
			undefined,
			{} as any,
			process.cwd(),
		);
		const t2 = new ToolExecutionComponent(
			"read",
			"call_2",
			{ path: "/tmp/file.ts" },
			{},
			undefined,
			{} as any,
			process.cwd(),
		);
		const t3 = new ToolExecutionComponent(
			"bash",
			"call_3",
			{ command: "npm test" },
			{},
			undefined,
			{} as any,
			process.cwd(),
		);

		container.addChild(t1);
		container.addChild(t2);
		container.addChild(t3);

		expect(isFirstToolInSequence(t1)).toBe(false);
		expect(isLastToolInSequence(t1)).toBe(false);
		expect(isLastToolInSequence(t2)).toBe(false);
		expect(isLastToolInSequence(t3)).toBe(true);

		const lines = container.render(100);
		expect(lines).toHaveLength(3);
		expect(stripAnsi(lines[0])).toBe("● Bash(git status)");
		expect(lines[0]).not.toContain("ctrl+o");
		expect(stripAnsi(lines[1])).toBe("● Read(/tmp/file.ts)");
		expect(lines[1]).not.toContain("ctrl+o");
		expect(stripAnsi(lines[2])).toBe("● Bash(npm test) (ctrl+o to expand)");
	});

	it("renders expanded view when setExpanded is true", () => {
		const container = new Container();
		const tool = new ToolExecutionComponent(
			"bash",
			"call_1",
			{ command: "echo hello" },
			{},
			undefined,
			{} as any,
			process.cwd(),
		);
		tool.updateResult({ content: [{ type: "text", text: "hello\nworld" }], isError: false });
		container.addChild(tool);

		tool.setExpanded(true);
		const lines = container.render(100);
		expect(stripAnsi(lines[0])).toBe("● Bash(echo hello)");
		expect(stripAnsi(lines[1])).toBe("  └ hello");
		expect(stripAnsi(lines[2])).toBe("    world (ctrl+o to collapse)");
	});
});
