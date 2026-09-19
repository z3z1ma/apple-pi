import { homedir } from "node:os";
import {
	AssistantMessageComponent,
	BranchSummaryMessageComponent,
	CompactionSummaryMessageComponent,
	initTheme,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, visibleWidth } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import {
	formatCollapsedLine,
	formatCompactionRule,
	formatCompactionSummary,
	formatExpandedLines,
	formatHorizontalLine,
	formatPath,
	formatStatusBullet,
	formatThinkingSpinnerMessage,
	formatThoughtHeader,
	formatThoughtSnippet,
	formatToolArgs,
	formatToolName,
	parseDiff,
	stripAnsi,
} from "../src/formatters.js";
import installTerseToolsExtension from "../src/installer.js";
import {
	installTerseToolRenderer,
	isFirstToolInSequence,
	isLastToolInSequence,
	isTransparentChild,
	precedingHasTextDelta,
	setActiveTheme,
} from "../src/patch.js";

const HOME = homedir();

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
		expect(stripAnsi(formatToolName("monitor", testTheme))).toBe("Monitor");
		expect(stripAnsi(formatToolName("pi_exec", testTheme))).toBe("Exec");
		expect(stripAnsi(formatToolName("ask_user_question", testTheme))).toBe("AskUserQuestion");
		expect(stripAnsi(formatToolName("update_notebook", testTheme))).toBe("UpdateNotebook");
		expect(stripAnsi(formatToolName("acknowledge_pair_findings", testTheme))).toBe("AcknowledgePairFindings");
		expect(stripAnsi(formatToolName("mcp__atlassian", testTheme))).toBe("McpAtlassian");
		expect(stripAnsi(formatToolName("mcp__slack", testTheme))).toBe("McpSlack");
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
		expect(formatToolArgs("manage_task", { action: "cancel", taskId: "task-58" })).toBe("cancel task-58");

		expect(
			formatToolArgs("schedule", {
				delay_seconds: 10,
				command: "npm test",
			}),
		).toBe("10s: npm test");
		expect(formatToolArgs("monitor", { command: "tail -F app.log | grep ERROR", max_events: 5 })).toBe(
			"tail -F app.log | grep ERROR",
		);

		expect(formatToolArgs("pi_exec", { title: "Trace prior cron and sensor design" })).toBe(
			"Trace prior cron and sensor design",
		);
		expect(
			formatToolArgs("pi_exec", {
				code: "await pi.read({ path: 'test.ts' })",
				display: { name: "Read test file" },
			}),
		).toBe("Read test file");
		expect(formatToolArgs("pi_exec", { code: "const x = 1;\nconsole.log(x);" })).toBe("const x = 1;");

		expect(
			formatToolArgs("ask_user_question", {
				questions: [{ question: "Do you want to proceed?" }],
			}),
		).toBe("Do you want to proceed?");

		expect(
			formatToolArgs("update_notebook", {
				reflections: [{ content: "Fix verified in Vitest" }],
				retireReflectionIds: [],
			}),
		).toBe("Fix verified in Vitest");
		expect(
			formatToolArgs("update_notebook", {
				reflections: [{ content: "First point" }, { content: "Second point" }],
				retireReflectionIds: [],
			}),
		).toBe("First point (+1 more)");
		expect(
			formatToolArgs("update_notebook", {
				reflections: [{ content: "New point" }],
				retireReflectionIds: ["a1b2c3d4e5f6"],
			}),
		).toBe("New point (retire: 1)");
		expect(
			formatToolArgs("update_notebook", {
				reflections: [],
				retireReflectionIds: ["a1b2c3d4e5f6", "b2c3d4e5f6a1"],
			}),
		).toBe("retire: a1b2c3d4e5f6, b2c3d4e5f6a1");

		expect(
			formatToolArgs("acknowledge_pair_findings", {
				findings: [{ id: "c1", disposition: "address", reason: "Fixing edge case" }],
			}),
		).toBe("address c1: Fixing edge case");
		expect(
			formatToolArgs("acknowledge_pair_findings", {
				findings: [
					{ id: "c1", disposition: "address", reason: "Fixing" },
					{ id: "c2", disposition: "decline", reason: "N/A" },
				],
			}),
		).toBe("address c1, decline c2");

		expect(
			formatToolArgs("agent", {
				subagent_type: "explorer",
				description: "Search for symbols across repo",
			}),
		).toBe("explorer: Search for symbols across repo");
		expect(
			formatToolArgs("agent", {
				subagent_type: "builder",
				description: "Implement tests",
				run_in_background: true,
			}),
		).toBe("builder (bg): Implement tests");

		expect(formatToolArgs("get_subagent_result", { agent_id: "agent-123", verbose: false })).toBe("agent-123");
		expect(formatToolArgs("steer_subagent", { agent_id: "agent-123", message: "Focus on index.ts" })).toBe(
			"agent-123: Focus on index.ts",
		);
		expect(formatToolArgs("stop_subagent", { agent_id: "agent-123" })).toBe("agent-123");

		expect(formatToolArgs("search_session", { query: "export function" })).toBe("export function");
		expect(formatToolArgs("search_session", { query: "#1:src/index.ts", mode: "file" })).toBe("#1:src/index.ts (file)");
		expect(formatToolArgs("search_session", { mode: "touched" })).toBe("mode: touched");
		expect(formatToolArgs("search_session", { expand: [1, 2] })).toBe("expand: 1, 2");

		expect(formatToolArgs("ledger_close", { task: "20260901-task", status: "done" })).toBe("done 20260901-task");
		expect(formatToolArgs("wiki_references", { target: "my-page", depth: 1, direction: "both" })).toBe("my-page");
		expect(formatToolArgs("wiki_references", { target: "my-page", depth: 2, direction: "inbound" })).toBe(
			"my-page (inbound, depth 2)",
		);

		expect(formatToolArgs("mcp", { tool: "get_issue", args: { issueId: "PROJ-1" } })).toBe(
			"get_issue(issueId: PROJ-1)",
		);
		expect(formatToolArgs("mcp", { search: "slack" })).toBe("search: slack");
		expect(formatToolArgs("mcp__atlassian", { tool: "get_issue", args: { issueId: "PROJ-2" } })).toBe(
			"get_issue(issueId: PROJ-2)",
		);

		expect(formatToolArgs("custom_tool", { query: "hello world" })).toBe("hello world");
		expect(formatToolArgs("custom_tool", { foo: "bar", count: 42 })).toBe("foo: bar, count: 42");
		expect(
			formatToolArgs("batch_tool", {
				items: [{ name: "First item" }, { name: "Second item" }],
			}),
		).toBe("items: First item (+1 more)");
		expect(formatToolArgs("execute_tool", { ids: [10, 20, 30] })).toBe("ids: 10, 20, 30");
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

	it("formats compaction divider rule with centered title and dim styling", () => {
		const rule = formatCompactionRule("Conversation compacted", 80, testTheme);
		expect(rule).toContain("\x1b[2m"); // dim
		const stripped = stripAnsi(rule);
		expect(visibleWidth(stripped)).toBe(80);
		expect(stripped).toContain(" Conversation compacted ");
		// Label is 24 chars (" Conversation compacted "), remaining 56 = 28 left, 28 right
		expect(stripped).toBe(`${"─".repeat(28)} Conversation compacted ${"─".repeat(28)}`);

		// Odd width
		const oddRule = stripAnsi(formatCompactionRule("Conversation compacted", 81, testTheme));
		expect(visibleWidth(oddRule)).toBe(81);
		expect(oddRule).toBe(`${"─".repeat(28)} Conversation compacted ${"─".repeat(29)}`);

		// Narrow width truncates gracefully
		const narrow = stripAnsi(formatCompactionRule("Conversation compacted", 20, testTheme));
		expect(visibleWidth(narrow)).toBeLessThanOrEqual(20);
		expect(narrow).toContain("...");

		// Width <= 0
		expect(formatCompactionRule("Conversation compacted", 0, testTheme)).toBe("");
	});

	it("formats horizontal rule spanning the terminal width", () => {
		const line = formatHorizontalLine(80, testTheme);
		expect(line).toContain("\x1b[2m");
		expect(stripAnsi(line)).toBe("─".repeat(80));
		expect(visibleWidth(stripAnsi(line))).toBe(80);
		expect(formatHorizontalLine(0, testTheme)).toBe("");
	});

	it("formats compaction summary in collapsed and expanded modes", () => {
		const summaryText = "Fixed the rendering bug in TUI.\nAll tests are passing.";

		// Collapsed mode: single line
		const collapsed = formatCompactionSummary("Conversation compacted", summaryText, false, 80, testTheme);
		expect(collapsed).toHaveLength(1);
		expect(stripAnsi(collapsed[0])).toBe(`${"─".repeat(28)} Conversation compacted ${"─".repeat(28)}`);

		// Expanded mode: header, blank line, markdown summary, blank line, closing rule
		const expanded = formatCompactionSummary("Conversation compacted", summaryText, true, 80, testTheme);
		expect(expanded[0]).toBe(collapsed[0]);
		expect(expanded[1]).toBe("");
		expect(stripAnsi(expanded[2])).toContain("Fixed the rendering bug in TUI.");
		expect(expanded[expanded.length - 2]).toBe("");
		expect(stripAnsi(expanded[expanded.length - 1])).toBe("─".repeat(80));

		// All expanded lines stay within terminal width
		for (const l of expanded) {
			expect(visibleWidth(l)).toBeLessThanOrEqual(80);
		}

		// Empty summary in expanded mode: header + closing rule
		const emptyExpanded = formatCompactionSummary("Conversation compacted", "", true, 80, testTheme);
		expect(emptyExpanded).toHaveLength(2);
		expect(emptyExpanded[0]).toBe(collapsed[0]);
		expect(stripAnsi(emptyExpanded[1])).toBe("─".repeat(80));
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

	it("uses warning color for tool names matching Antigravity gold", () => {
		const formatted = formatToolName("bash", testTheme);
		expect(formatted).toContain("\x1b[33m");
		expect(formatted).not.toContain("\x1b[36m");
	});

	it("formats thought header with duration and tokens", () => {
		expect(stripAnsi(formatThoughtHeader(3200, 1500, testTheme))).toBe("▶ Thought for 3s, 1.5k tokens");
		expect(stripAnsi(formatThoughtHeader(10000, undefined, testTheme))).toBe("▶ Thought for 10s");
		expect(stripAnsi(formatThoughtHeader(undefined, 850, testTheme))).toBe("▶ Thought for 850 tokens");
		expect(stripAnsi(formatThoughtHeader(undefined, undefined, testTheme))).toBe("▶ Thought");
		expect(formatThoughtHeader(1000, 100, testTheme)).toContain("\x1b[2m"); // muted
	});

	it("formats thought snippet with indentation and line trimming", () => {
		const thinking = "\n  Examining the repository structure\nSecond line";
		expect(stripAnsi(formatThoughtSnippet(thinking, 80, testTheme))).toBe("  Examining the repository structure");

		const longLine = "x".repeat(100);
		const truncated = formatThoughtSnippet(longLine, 40, testTheme);
		expect(stripAnsi(truncated)).toBe(`  ${"x".repeat(33)}...`);
	});

	it("identifies transparent intermediate siblings with isTransparentChild", () => {
		expect(isTransparentChild(null)).toBe(true);
		expect(isTransparentChild(undefined)).toBe(true);
		expect(isTransparentChild(new Spacer(1))).toBe(true);

		const toolOnlyMsg = new AssistantMessageComponent(
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "c1", name: "bash", args: {} }],
				api: "chat",
				provider: "test",
				model: "m",
				usage: { inputTokens: 5, outputTokens: 10 },
				stopReason: "toolUse",
				timestamp: Date.now(),
			} as any,
			true,
		);
		expect(isTransparentChild(toolOnlyMsg)).toBe(true);

		const thoughtOnlyMsg = new AssistantMessageComponent(
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "thinking before tool" },
					{ type: "toolCall", id: "c1", name: "bash", args: {} },
				],
				api: "chat",
				provider: "test",
				model: "m",
				usage: { inputTokens: 5, outputTokens: 10 },
				stopReason: "toolUse",
				timestamp: Date.now(),
			} as any,
			true,
		);
		expect(isTransparentChild(thoughtOnlyMsg)).toBe(true);

		const textMsg = new AssistantMessageComponent(
			{
				role: "assistant",
				content: [{ type: "text", text: "Finished the task." }],
				api: "chat",
				provider: "test",
				model: "m",
				usage: { inputTokens: 5, outputTokens: 10 },
				stopReason: "stop",
				timestamp: Date.now(),
			} as any,
			true,
		);
		expect(isTransparentChild(textMsg)).toBe(false);
	});

	it("unifies multi-turn tool loops across hidden intermediate thinking", () => {
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

		const intermediateAssistant = new AssistantMessageComponent(
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Inspecting the file before the next tool call" },
					{ type: "toolCall", id: "call_2", name: "read", args: { path: "foo.ts" } },
				],
				api: "chat",
				provider: "test",
				model: "m",
				usage: { inputTokens: 10, outputTokens: 20 },
				stopReason: "toolUse",
				timestamp: Date.now(),
			} as any,
			true,
		);

		const t2 = new ToolExecutionComponent(
			"read",
			"call_2",
			{ path: "foo.ts" },
			{},
			undefined,
			{} as any,
			process.cwd(),
		);

		container.addChild(t1);
		container.addChild(intermediateAssistant);
		container.addChild(t2);

		// Hidden thinking contributes no rows between tool calls.
		expect(intermediateAssistant.render(80)).toHaveLength(0);

		// t1 recognizes intermediateAssistant is transparent, so t1 is NOT the last tool
		expect(isLastToolInSequence(t1)).toBe(false);
		// t2 is the last tool
		expect(isLastToolInSequence(t2)).toBe(true);

		// Multi-turn tools render contiguously with no blank line between them
		const lines = container.render(100);
		expect(lines).toHaveLength(2);
		expect(stripAnsi(lines[0])).toBe("● Bash(git status)");
		expect(lines[0]).not.toContain("ctrl+o");
		expect(stripAnsi(lines[1])).toBe("● Read(foo.ts) (ctrl+o to expand)");
	});

	it("preserves thought card before tool calls and keeps them dense", () => {
		const container = new Container();

		const thoughtAssistant = new AssistantMessageComponent(
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "The crash log indicates a line rendering issue exceeding terminal width" },
					{ type: "toolCall", id: "call_1", name: "bash", args: { command: "git status" } },
				],
				api: "chat",
				provider: "test",
				model: "m",
				usage: { inputTokens: 100, outputTokens: 595 },
				stopReason: "toolUse",
				timestamp: Date.now(),
			} as any,
			false,
		);

		const tool = new ToolExecutionComponent(
			"bash",
			"call_1",
			{ command: "git status" },
			{},
			undefined,
			{} as any,
			process.cwd(),
		);

		container.addChild(thoughtAssistant);
		container.addChild(tool);

		// Tool call does NOT prepend a newline after thinking alone
		expect(precedingHasTextDelta(tool)).toBe(false);

		const lines = container.render(100);
		const joined = lines.map(stripAnsi).join("\n");
		expect(joined).toContain("▶ Thought");
		expect(joined).toContain("595 tokens");
		expect(joined).toContain("The crash log indicates");
		expect(joined).toContain("● Bash(git status) (ctrl+o to expand)");

		// Thought card has a line break at the bottom before subsequent tool call
		const thoughtIdx = lines.findIndex((l) => l.includes("The crash log indicates"));
		expect(thoughtIdx).toBeGreaterThanOrEqual(0);
		expect(lines[thoughtIdx + 1]).toBe("");
		expect(stripAnsi(lines[thoughtIdx + 2])).toContain("Bash(git status)");
	});

	it("ensures harmonious 1 blank line before and after thought cards across multi-turn tools", () => {
		const container = new Container();

		const tool1 = new ToolExecutionComponent(
			"bash",
			"call_1",
			{ command: "git status" },
			{},
			undefined,
			{} as any,
			process.cwd(),
		);
		container.addChild(tool1);

		// Turn 2: Thought card without text before tool call
		const thoughtAssistant = new AssistantMessageComponent(
			undefined,
			false, // hideThinkingBlock = false
		);
		container.addChild(thoughtAssistant);

		thoughtAssistant.updateContent(
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Analyzing the repository state" },
					{ type: "toolCall", id: "call_2", name: "read", args: { path: "foo.ts" } },
				],
				usage: { outputTokens: 500 },
			} as any,
			false,
		);

		const tool2 = new ToolExecutionComponent(
			"read",
			"call_2",
			{ path: "foo.ts" },
			{},
			undefined,
			{} as any,
			process.cwd(),
		);
		container.addChild(tool2);

		const lines = container.render(100);
		expect(stripAnsi(lines[0])).toBe("● Bash(git status) (ctrl+o to expand)");
		expect(lines[1]).toBe("");
		expect(stripAnsi(lines[2])).toContain("▶ Thought");
		expect(stripAnsi(lines[3])).toContain("Analyzing the repository state");
		expect(lines[4]).toBe("");
		expect(stripAnsi(lines[5])).toBe("● Read(foo.ts) (ctrl+o to expand)");
		expect(lines).toHaveLength(6);
	});

	it("ensures single blank line between thought card and text delta, and before next tool", () => {
		const container = new Container();

		const tool1 = new ToolExecutionComponent(
			"bash",
			"call_1",
			{ command: "git status" },
			{},
			undefined,
			{} as any,
			process.cwd(),
		);
		container.addChild(tool1);

		// Assistant message with thought AND text delta
		const assistantMsg = new AssistantMessageComponent(undefined, false);
		container.addChild(assistantMsg);

		assistantMsg.updateContent(
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Analyzing the repository state" },
					{ type: "text", text: "README is the pitch." },
					{ type: "toolCall", id: "call_2", name: "read", args: { path: "foo.ts" } },
				],
				usage: { outputTokens: 500 },
			} as any,
			false,
		);

		const tool2 = new ToolExecutionComponent(
			"read",
			"call_2",
			{ path: "foo.ts" },
			{},
			undefined,
			{} as any,
			process.cwd(),
		);
		container.addChild(tool2);

		const lines = container.render(100);
		expect(stripAnsi(lines[0])).toBe("● Bash(git status) (ctrl+o to expand)");
		// Exactly 1 blank line before thought card
		expect(lines[1]).toBe("");
		expect(stripAnsi(lines[2])).toContain("▶ Thought");
		expect(stripAnsi(lines[3])).toContain("Analyzing the repository state");
		// Exactly 1 blank line between thought card and text
		expect(lines[4]).toBe("");
		expect(stripAnsi(lines[5])).toContain("README is the pitch.");
		// Exactly 1 blank line between text and next tool
		expect(lines[6]).toBe("");
		expect(stripAnsi(lines[7])).toBe("● Read(foo.ts) (ctrl+o to expand)");
		expect(lines).toHaveLength(8);
	});

	it("prepends a newline before tool call when preceded by a text delta", () => {
		const container = new Container();

		const textAssistant = new AssistantMessageComponent(
			{
				role: "assistant",
				content: [
					{ type: "text", text: "I will start by checking git status." },
					{ type: "toolCall", id: "call_1", name: "bash", args: { command: "git status" } },
				],
				api: "chat",
				provider: "test",
				model: "m",
				usage: { inputTokens: 50, outputTokens: 50 },
				stopReason: "toolUse",
				timestamp: Date.now(),
			} as any,
			true,
		);

		const tool = new ToolExecutionComponent(
			"bash",
			"call_1",
			{ command: "git status" },
			{},
			undefined,
			{} as any,
			process.cwd(),
		);

		container.addChild(textAssistant);
		container.addChild(tool);

		expect(precedingHasTextDelta(tool)).toBe(true);

		const lines = container.render(100);
		// lines must contain text followed by a blank line before tool call
		const textIdx = lines.findIndex((l) => l.includes("I will start by checking"));
		expect(textIdx).toBeGreaterThanOrEqual(0);
		expect(lines[textIdx + 1]).toBe("");
		expect(stripAnsi(lines[textIdx + 2])).toContain("Bash(git status)");
	});

	it("customizes thinking display to Antigravity thought card when text follows", () => {
		const assistantMsg = new AssistantMessageComponent(
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Analyzing the solution\nSecond line" },
					{ type: "text", text: "Here is the result." },
				],
				api: "chat",
				provider: "test",
				model: "m",
				usage: { inputTokens: 100, outputTokens: 2400 },
				stopReason: "stop",
				timestamp: Date.now(),
			} as any,
			false,
		);

		const lines = assistantMsg.render(80);
		const joined = lines.map(stripAnsi).join("\n");
		expect(joined).toContain("▶ Thought");
		expect(joined).toContain("2.4k tokens");
		expect(joined).toContain("Analyzing the solution");
		expect(joined).not.toContain("Thinking...");
	});

	it("hides thought cards without hiding the following assistant text", () => {
		const assistantMsg = new AssistantMessageComponent(
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Private reasoning" },
					{ type: "text", text: "Visible answer." },
				],
				api: "chat",
				provider: "test",
				model: "m",
				usage: { inputTokens: 100, outputTokens: 200 },
				stopReason: "stop",
				timestamp: Date.now(),
			} as any,
			true,
		);

		const joined = assistantMsg.render(80).map(stripAnsi).join("\n");
		expect(joined).toContain("Visible answer.");
		expect(joined).not.toContain("Thought");
		expect(joined).not.toContain("Private reasoning");
	});

	it("truncates long collapsed commands to terminal width while preserving hint", () => {
		const longCmd =
			'ls components && echo "==== extensions ====" && ls extensions && echo "==== pair-programmer ====" && ls components/pair-programmer && echo "==== pair src ====" && find components/pair-programmer -type f | head -80';
		const line = formatCollapsedLine("bash", { command: longCmd }, "running", true, testTheme, undefined, 123);
		expect(visibleWidth(line)).toBeLessThanOrEqual(123);
		expect(line).toContain("ctrl+o to expand");
		expect(line).toContain("...");
	});

	it("guarantees ToolExecutionComponent.render lines never exceed terminal width", () => {
		const container = new Container();
		const longCmd = `${"echo ".repeat(50)}very-long-argument-string`;
		const tool = new ToolExecutionComponent(
			"bash",
			"call_long",
			{ command: longCmd },
			{},
			undefined,
			{} as any,
			process.cwd(),
		);
		container.addChild(tool);

		// Collapsed
		const collapsedLines = tool.render(80);
		for (const l of collapsedLines) {
			expect(visibleWidth(l)).toBeLessThanOrEqual(80);
		}

		// Expanded
		tool.setExpanded(true);
		tool.updateResult({
			content: [{ type: "text", text: `${"line 1 ".repeat(30)}\nline 2` }],
			isError: false,
		});
		const expandedLines = tool.render(80);
		for (const l of expandedLines) {
			expect(visibleWidth(l)).toBeLessThanOrEqual(80);
		}
	});

	it("hides Thinking... from the transcript completely", () => {
		const hiddenThinkingMsg = new AssistantMessageComponent(
			{
				role: "assistant",
				content: [{ type: "thinking", thinking: "Analyzing something" }],
				api: "chat",
				provider: "test",
				model: "m",
				usage: { inputTokens: 10, outputTokens: 20 },
				stopReason: "stop",
				timestamp: Date.now(),
			} as any,
			true,
		);

		const lines = hiddenThinkingMsg.render(80);
		expect(lines).toEqual([]);
	});

	it("suppresses transcript output while streaming thinking before tools or text", () => {
		const streamingThinkingMsg = new AssistantMessageComponent(
			{
				role: "assistant",
				content: [{ type: "thinking", thinking: "Actively thinking about the next step" }],
				api: "chat",
				provider: "test",
				model: "m",
				timestamp: Date.now(),
			} as any,
			true,
		);
		(streamingThinkingMsg as any).isStreaming = true;

		const lines = streamingThinkingMsg.render(80);
		expect(lines).toHaveLength(0);
	});

	it("renders CompactionSummaryMessageComponent as single divider line when collapsed", () => {
		const comp = new CompactionSummaryMessageComponent({
			role: "compactionSummary",
			summary: "Successfully compacted the context.",
			tokensBefore: 45000,
			timestamp: Date.now(),
		});

		const lines = comp.render(80);
		expect(lines).toHaveLength(1);
		expect(stripAnsi(lines[0])).toBe(`${"─".repeat(28)} Conversation compacted ${"─".repeat(28)}`);
		expect(visibleWidth(lines[0])).toBe(80);
	});

	it("renders CompactionSummaryMessageComponent with Antigravity card layout when expanded", () => {
		const comp = new CompactionSummaryMessageComponent({
			role: "compactionSummary",
			summary: "Short summary of work done.",
			tokensBefore: 45000,
			timestamp: Date.now(),
		});
		comp.setExpanded(true);

		const lines = comp.render(80);
		expect(lines.length).toBeGreaterThan(2);
		expect(stripAnsi(lines[0])).toBe(`${"─".repeat(28)} Conversation compacted ${"─".repeat(28)}`);
		expect(lines[1]).toBe("");
		expect(stripAnsi(lines[2])).toContain("Short summary of work done.");
		expect(lines[lines.length - 2]).toBe("");
		expect(stripAnsi(lines[lines.length - 1])).toBe("─".repeat(80));

		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(80);
		}
	});

	it("renders BranchSummaryMessageComponent as centered divider line when collapsed and card when expanded", () => {
		const comp = new BranchSummaryMessageComponent({
			role: "branchSummary",
			summary: "Summary of branch exploration.",
			fromId: "parent-id",
			timestamp: Date.now(),
		});

		const collapsed = comp.render(80);
		expect(collapsed).toHaveLength(1);
		expect(stripAnsi(collapsed[0])).toContain("Branch summary");
		expect(visibleWidth(collapsed[0])).toBe(80);

		comp.setExpanded(true);
		const expanded = comp.render(80);
		expect(stripAnsi(expanded[0])).toContain("Branch summary");
		expect(stripAnsi(expanded[expanded.length - 1])).toBe("─".repeat(80));
		for (const line of expanded) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(80);
		}
	});

	it("ensures clean vertical spacing between compaction and following tool calls", () => {
		const container = new Container();

		const compaction = new CompactionSummaryMessageComponent({
			role: "compactionSummary",
			summary: "Compacted",
			tokensBefore: 12000,
			timestamp: Date.now(),
		});
		container.addChild(compaction);

		const tool1 = new ToolExecutionComponent(
			"bash",
			"call_1",
			{ command: "git status" },
			{},
			undefined,
			{} as any,
			process.cwd(),
		);
		container.addChild(tool1);

		const tool2 = new ToolExecutionComponent(
			"bash",
			"call_2",
			{ command: "npm test" },
			{},
			undefined,
			{} as any,
			process.cwd(),
		);
		container.addChild(tool2);

		const lines = container.render(80);
		expect(stripAnsi(lines[0])).toBe(`${"─".repeat(28)} Conversation compacted ${"─".repeat(28)}`);
		expect(lines[1]).toBe("");
		expect(stripAnsi(lines[2])).toBe("● Bash(git status)");
		expect(stripAnsi(lines[3])).toBe("● Bash(npm test) (ctrl+o to expand)");
		expect(lines).toHaveLength(4);
	});

	it("ensures clean vertical spacing when tool follows compaction across transparent assistant message", () => {
		const container = new Container();

		const compaction = new CompactionSummaryMessageComponent({
			role: "compactionSummary",
			summary: "Compacted",
			tokensBefore: 12000,
			timestamp: Date.now(),
		});
		container.addChild(compaction);

		const transparentAssistant = new AssistantMessageComponent(
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "call_1", name: "bash", args: { command: "git status" } }],
				api: "chat",
				provider: "test",
				model: "m",
				usage: { inputTokens: 10, outputTokens: 20 },
				stopReason: "toolUse",
				timestamp: Date.now(),
			} as any,
			true,
		);
		container.addChild(transparentAssistant);

		const tool = new ToolExecutionComponent(
			"bash",
			"call_1",
			{ command: "git status" },
			{},
			undefined,
			{} as any,
			process.cwd(),
		);
		container.addChild(tool);

		const lines = container.render(80);
		expect(stripAnsi(lines[0])).toBe(`${"─".repeat(28)} Conversation compacted ${"─".repeat(28)}`);
		expect(lines[1]).toBe("");
		expect(stripAnsi(lines[2])).toBe("● Bash(git status) (ctrl+o to expand)");
		expect(lines).toHaveLength(3);
	});
});

describe("thinking spinner formatting", () => {
	it("returns Thinking... for empty or whitespace thinking text", () => {
		expect(formatThinkingSpinnerMessage("")).toBe("Thinking...");
		expect(formatThinkingSpinnerMessage("   \n\n  ")).toBe("Thinking...");
	});

	it("extracts and formats active thought trace from single or multiline thinking", () => {
		expect(formatThinkingSpinnerMessage("Checking git status")).toBe("Thinking (Checking git status)");

		const multiline = `
I need to inspect the code.
First checking the patch file.
Now checking the tests.
`;
		expect(formatThinkingSpinnerMessage(multiline)).toBe("Thinking (Now checking the tests.)");
	});

	it("strips markdown headers, bullets, backticks, and bold/italic markers", () => {
		expect(formatThinkingSpinnerMessage("### Determining the root cause")).toBe(
			"Thinking (Determining the root cause)",
		);
		expect(formatThinkingSpinnerMessage("- Examining `patch.ts` for errors")).toBe(
			"Thinking (Examining patch.ts for errors)",
		);
		expect(formatThinkingSpinnerMessage("1. **Crucial** verification step")).toBe(
			"Thinking (Crucial verification step)",
		);
	});

	it("truncates long thought trace to maxWidth", () => {
		const longThought = "A".repeat(80);
		const formatted = formatThinkingSpinnerMessage(longThought, 30);
		expect(formatted).toBe(`Thinking (${"A".repeat(27)}...)`);
	});
});

describe("terse tools extension spinner and label lifecycle", () => {
	it("hooks into Pi extension events to manage spinner and clear hidden thinking label", () => {
		const handlers = new Map<string, (event: any, ctx: any) => void>();
		const mockPi: any = {
			on(event: string, handler: (event: any, ctx: any) => void) {
				handlers.set(event, handler);
			},
		};

		let workingMessage: string | undefined = "original";
		let hiddenLabel: string | undefined = "original";

		const mockCtx: any = {
			ui: {
				setWorkingMessage(msg?: string) {
					workingMessage = msg;
				},
				setHiddenThinkingLabel(label?: string) {
					hiddenLabel = label;
				},
			},
		};

		installTerseToolsExtension(mockPi);

		// session_start clears hidden thinking label
		handlers.get("session_start")?.({}, mockCtx);
		expect(hiddenLabel).toBe("");

		// turn_start clears hidden thinking label
		hiddenLabel = "dirty";
		handlers.get("turn_start")?.({}, mockCtx);
		expect(hiddenLabel).toBe("");

		// message_update with thinking updates the spinner
		handlers.get("message_update")?.(
			{
				message: {
					role: "assistant",
					content: [{ type: "thinking", thinking: "Analyzing the solution" }],
				},
			},
			mockCtx,
		);
		expect(workingMessage).toBe("Thinking (Analyzing the solution)");

		// message_update with subsequent toolCall restores spinner
		handlers.get("message_update")?.(
			{
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "Analyzing the solution" },
						{ type: "toolCall", id: "c1", name: "bash", arguments: {} },
					],
				},
			},
			mockCtx,
		);
		expect(workingMessage).toBeUndefined();

		// message_update with subsequent text restores spinner
		handlers.get("message_update")?.(
			{
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "Analyzing the solution" },
						{ type: "text", text: "Here is the plan" },
					],
				},
			},
			mockCtx,
		);
		expect(workingMessage).toBeUndefined();

		// tool_execution_start restores spinner
		workingMessage = "Thinking (dirty)";
		handlers.get("tool_execution_start")?.({}, mockCtx);
		expect(workingMessage).toBeUndefined();

		// message_end restores spinner
		workingMessage = "Thinking (dirty)";
		handlers.get("message_end")?.({}, mockCtx);
		expect(workingMessage).toBeUndefined();

		// turn_end restores spinner
		workingMessage = "Thinking (dirty)";
		handlers.get("turn_end")?.({}, mockCtx);
		expect(workingMessage).toBeUndefined();

		// agent_end restores spinner
		workingMessage = "Thinking (dirty)";
		handlers.get("agent_end")?.({}, mockCtx);
		expect(workingMessage).toBeUndefined();
	});
});
