import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, assert, expect, test } from "vitest";

const testRoot = mkdtempSync(join(tmpdir(), "pi-notify-test-"));
const testApp = join(testRoot, "Pi Notifier.app");
const testNotifier = join(testApp, "Contents", "MacOS", "terminal-notifier");
mkdirSync(join(testApp, "Contents", "MacOS"), { recursive: true });
writeFileSync(testNotifier, "#!/bin/sh\nexit 0\n");
chmodSync(testNotifier, 0o755);
afterAll(() => rmSync(testRoot, { recursive: true, force: true }));

process.env.PI_NOTIFY_APP = testApp;
process.env.PI_NOTIFY_DISABLE_LOG = "1";
process.env.TMUX_PANE = "%931";

// The extension delivers only on macOS; pin the platform so the lifecycle
// assertions are deterministic on any host running the suite.
Object.defineProperty(process, "platform", { value: "darwin" });

const extension = await import("../src/index.js");

const {
	askQuestionSummary,
	buildFocusCommand,
	cleanPaneTitle,
	default: registerPiNotify,
	extractMessageText,
	notificationSubtitle,
	notificationSummary,
	parseTmuxTarget,
	shellQuote,
	shortDisplayText,
} = extension;

test("formats prompt subtitles for macOS notifications", () => {
	expect(notificationSubtitle("[Image #1] What is the first option")).toBe("What is the first option");
	expect(notificationSubtitle("[Image #2]")).toBe("Image request");
	expect(shortDisplayText("🙂".repeat(25), 48)).toBe(`${"🙂".repeat(22)}...`);
});

test("summarizes assistant output without generic Markdown headings", () => {
	expect(notificationSummary("## Conclusion\n\nThe Pi notify extension is installed.\n\nMore detail")).toBe(
		"The Pi notify extension is installed.",
	);
	expect(notificationSummary("[config file](file:///tmp/config.ts) has been updated.")).toBe(
		"config file has been updated.",
	);
});

test("summarizes ask_user_question prompts for the notification body", () => {
	expect(askQuestionSummary({ questions: [{ question: "Which storage backend?" }] })).toBe("Which storage backend?");
	expect(askQuestionSummary({ questions: [{ question: "Which backend?" }, { question: "Which region?" }] })).toBe(
		"Which backend? (+1 more)",
	);
	expect(askQuestionSummary({ questions: [] })).toBe("Pi needs your input.");
	expect(askQuestionSummary(undefined)).toBe("Pi needs your input.");
});

test("extracts only visible assistant text", () => {
	expect(
		extractMessageText({
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "internal" },
				{ type: "text", text: "first line" },
				{ type: "toolCall", name: "read" },
				{ type: "text", text: "second line" },
			],
		}),
	).toBe("first line\nsecond line");
});

test("parses tmux coordinates and builds a safely quoted focus command", () => {
	const target = parseTmuxTarget("$0\tcurrent work\t@343\t21\t%931\t1\tπ - notify test\n");
	expect(target).toEqual({
		coordinate: "0:21:1",
		sessionName: "current work",
		windowId: "@343",
		windowIndex: "21",
		paneId: "%931",
		paneIndex: "1",
		paneTitle: "π - notify test",
	});
	assert.ok(target);
	expect(cleanPaneTitle(target.paneTitle)).toBe("notify test");
	expect(shellQuote("a'b")).toBe("'a'\\''b'");
	const command = buildFocusCommand(target);
	expect(command).toMatch(/focus-tmux\.sh/);
	expect(command).toMatch(/'current work'/);
	expect(command).toMatch(/'%931'/);
});

test("bakes the absolute tmux binary and socket into the click command", () => {
	const target = parseTmuxTarget("$2\tcurrent work\t@343\t21\t%931\t1\tπ\n");
	assert.ok(target);
	const command = buildFocusCommand(target, "/run/current-system/sw/bin/tmux", "/private/tmp/tmux-502/default");
	// The click runs with no $TMUX or interactive $PATH, so both the tmux path
	// and the server socket must be present in the stored command string.
	expect(command).toMatch(/'TMUX_BIN=\/run\/current-system\/sw\/bin\/tmux'/);
	expect(command).toMatch(/'TMUX_SOCKET=\/private\/tmp\/tmux-502\/default'/);
	expect(command).toMatch(/'\/usr\/bin\/env'/);
	expect(command).toMatch(/focus-tmux\.sh/);
	// Omitting the optional args must not emit empty env assignments.
	expect(buildFocusCommand(target)).not.toMatch(/TMUX_BIN=/);
});

interface HarnessCall {
	command: string;
	args: string[];
}

function createLifecycleHarness({ focused = false }: { focused?: boolean } = {}) {
	const handlers = new Map<string, (...args: unknown[]) => unknown>();
	const commands = new Map<string, unknown>();
	const calls: HarnessCall[] = [];
	const pi = {
		on(name: string, handler: (...args: unknown[]) => unknown) {
			handlers.set(name, handler);
		},
		registerCommand(name: string, command: unknown) {
			commands.set(name, command);
		},
		getSessionName() {
			return "notify test";
		},
		async exec(command: string, args: string[]) {
			calls.push({ command, args });
			if (args.some((arg) => String(arg).includes("focus-check.sh"))) {
				// focus-check.sh exits 0 only when the operator is already viewing
				// the pane; non-zero otherwise.
				return { code: focused ? 0 : 1, stdout: "", stderr: "", killed: false };
			}
			if (String(command).endsWith("tmux")) {
				return {
					code: 0,
					stdout: "$0\tcurrent\t@343\t21\t%931\t1\tπ - alfheim\n",
					stderr: "",
					killed: false,
				};
			}
			if (command === "git") {
				return {
					code: 0,
					stdout: "/Users/alfheim\n",
					stderr: "",
					killed: false,
				};
			}
			return { code: 0, stdout: "", stderr: "", killed: false };
		},
	};

	registerPiNotify(pi as unknown as Parameters<typeof registerPiNotify>[0]);
	const ctx = {
		mode: "tui",
		cwd: "/Users/alfheim",
		isIdle: () => true,
		sessionManager: {
			getSessionId: () => "session-123",
			getLeafId: () => "leaf-456",
			getBranch: () => [],
		},
	};
	return { calls, commands, ctx, handlers };
}

function notifierCall(calls: HarnessCall[]) {
	return calls.find((call) => String(call.command).includes("Pi Notifier.app/Contents/MacOS/terminal-notifier"));
}

function focusCheckCall(calls: HarnessCall[]) {
	return calls.find((call) => call.args.some((arg) => String(arg).includes("focus-check.sh")));
}

async function flushUntil(predicate: () => boolean, tries = 50): Promise<void> {
	for (let attempt = 0; attempt < tries; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setImmediate(resolve));
	}
}

test("registers lifecycle handlers and sends after agent_settled", async () => {
	const { calls, commands, ctx, handlers } = createLifecycleHarness();
	expect([...handlers.keys()]).toEqual([
		"input",
		"before_agent_start",
		"message_end",
		"session_compact_failed",
		"tool_execution_start",
		"agent_settled",
	]);
	expect(commands.has("notify-setup")).toBe(true);
	expect(commands.has("notify-test")).toBe(true);

	handlers.get("input")?.({ text: "help me build notifications", source: "interactive" });
	handlers.get("before_agent_start")?.({ prompt: "expanded prompt" });
	handlers.get("message_end")?.({
		message: {
			role: "assistant",
			content: [{ type: "text", text: "Implemented and passing tests." }],
		},
	});

	expect(handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx)).toBeUndefined();
	await flushUntil(() => Boolean(notifierCall(calls)));

	const call = notifierCall(calls);
	assert.ok(call, "custom Pi notifier should be selected");
	expect(call.args.slice(0, 6)).toEqual([
		"-title",
		"0:21:1 · notify test",
		"-subtitle",
		"help me build notifications",
		"-message",
		"Implemented and passing tests.",
	]);
	expect(call.args.includes("-execute")).toBe(true);
});

test("suppresses the settle notification when the operator is already viewing the pane", async () => {
	const { calls, ctx, handlers } = createLifecycleHarness({ focused: true });
	handlers.get("input")?.({ text: "do the thing", source: "interactive" });
	handlers.get("before_agent_start")?.({ prompt: "do the thing" });
	handlers.get("message_end")?.({
		message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
	});

	handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
	await flushUntil(() => Boolean(focusCheckCall(calls)));

	const check = focusCheckCall(calls);
	assert.ok(check, "focus-check.sh should run before delivery on the settle path");
	expect(notifierCall(calls)).toBeUndefined();
});

test("notifies when ask_user_question starts but not for other tools", async () => {
	const { calls, ctx, handlers } = createLifecycleHarness();
	handlers.get("input")?.({ text: "help me pick a backend", source: "interactive" });
	handlers.get("before_agent_start")?.({ prompt: "help me pick a backend" });

	// A non-ask tool must never notify, even though it also starts mid-turn.
	handlers.get("tool_execution_start")?.({ toolName: "read", args: { path: "README.md" } }, ctx);
	await flushUntil(() => calls.length > 0, 5);
	expect(notifierCall(calls)).toBeUndefined();

	handlers.get("tool_execution_start")?.(
		{ toolName: "ask_user_question", args: { questions: [{ question: "Which storage backend?" }] } },
		ctx,
	);
	// Delivery is fire-and-forget, so wait for the notifier spawn to land.
	await flushUntil(() => Boolean(notifierCall(calls)));

	const call = notifierCall(calls);
	assert.ok(call, "ask_user_question should trigger a notification");
	expect(call.args.slice(2, 6)).toEqual(["-subtitle", "help me pick a backend", "-message", "Which storage backend?"]);
});

test("reports terminal cyber_policy errors instead of completion", async () => {
	const { calls, ctx, handlers } = createLifecycleHarness();
	handlers.get("input")?.({ text: "continue the current task", source: "interactive" });
	handlers.get("before_agent_start")?.({ prompt: "continue the current task" });
	handlers.get("message_end")?.({
		message: {
			role: "assistant",
			content: [{ type: "thinking", thinking: "internal" }],
			stopReason: "error",
			errorMessage:
				"Codex error: This content was flagged for possible cybersecurity risk. To get authorized for security work, join the Trusted Access for Cyber program.",
		},
	});

	handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
	await flushUntil(() => Boolean(notifierCall(calls)));

	const call = notifierCall(calls);
	assert.ok(call, "custom Pi notifier should be selected");
	expect(call.args.slice(2, 6)).toEqual([
		"-subtitle",
		"continue the current task",
		"-message",
		"Task blocked by cyber_policy; return to Pi for details.",
	]);
});

test("reports an aborted task instead of completion", async () => {
	const { calls, ctx, handlers } = createLifecycleHarness();
	handlers.get("input")?.({ text: "stop the current task", source: "interactive" });
	handlers.get("before_agent_start")?.({ prompt: "stop the current task" });
	handlers.get("message_end")?.({
		message: {
			role: "assistant",
			content: [{ type: "text", text: "partial result not finished" }],
			stopReason: "aborted",
			errorMessage: "Request was aborted",
		},
	});

	handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
	await flushUntil(() => Boolean(notifierCall(calls)));

	const call = notifierCall(calls);
	assert.ok(call, "custom Pi notifier should be selected");
	expect(call.args.slice(2, 6)).toEqual(["-subtitle", "stop the current task", "-message", "Task cancelled."]);
});

test("reports a failed compaction instead of a stale successful assistant response", async () => {
	const { calls, ctx, handlers } = createLifecycleHarness();
	handlers.get("input")?.({ text: "continue the current task", source: "interactive" });
	handlers.get("before_agent_start")?.({ prompt: "continue the current task" });
	handlers.get("message_end")?.({
		message: { role: "assistant", content: [{ type: "text", text: "Stale success." }], stopReason: "stop" },
	});
	handlers.get("session_compact_failed")?.({
		type: "session_compact_failed",
		reason: "overflow",
		errorMessage: "Context compaction failed",
		aborted: false,
		willRetry: true,
		fromExtension: false,
	});

	handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
	await flushUntil(() => Boolean(notifierCall(calls)));

	const call = notifierCall(calls);
	assert.ok(call, "failed compaction should trigger a failure notification");
	expect(call.args.slice(4, 6)).toEqual(["-message", "Task failed: Context compaction failed"]);
});

test("reports cancelled compaction instead of a stale successful assistant response", async () => {
	const { calls, ctx, handlers } = createLifecycleHarness();
	handlers.get("input")?.({ text: "continue the current task", source: "interactive" });
	handlers.get("before_agent_start")?.({ prompt: "continue the current task" });
	handlers.get("message_end")?.({
		message: { role: "assistant", content: [{ type: "text", text: "Stale success." }], stopReason: "stop" },
	});
	handlers.get("session_compact_failed")?.({
		type: "session_compact_failed",
		reason: "manual",
		aborted: true,
		willRetry: false,
		fromExtension: false,
	});

	handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
	await flushUntil(() => Boolean(notifierCall(calls)));

	const call = notifierCall(calls);
	assert.ok(call, "cancelled compaction should trigger a cancellation notification");
	expect(call.args.slice(4, 6)).toEqual(["-message", "Task cancelled."]);
});

test("clears a provisional compaction failure when a later assistant response succeeds", async () => {
	const { calls, ctx, handlers } = createLifecycleHarness();
	handlers.get("input")?.({ text: "continue the current task", source: "interactive" });
	handlers.get("before_agent_start")?.({ prompt: "continue the current task" });
	handlers.get("session_compact_failed")?.({
		type: "session_compact_failed",
		reason: "overflow",
		errorMessage: "temporary compaction failure",
		aborted: false,
		willRetry: true,
		fromExtension: false,
	});
	handlers.get("message_end")?.({
		message: {
			role: "assistant",
			content: [{ type: "text", text: "Task completed after compaction recovery." }],
			stopReason: "stop",
		},
	});

	handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
	await flushUntil(() => Boolean(notifierCall(calls)));

	const call = notifierCall(calls);
	assert.ok(call, "recovered compaction should trigger a completion notification");
	expect(call.args.slice(4, 6)).toEqual(["-message", "Task completed after compaction recovery."]);
});

test("clears a transient error when an automatic retry succeeds", async () => {
	const { calls, ctx, handlers } = createLifecycleHarness();
	handlers.get("input")?.({ text: "continue the current task", source: "interactive" });
	handlers.get("before_agent_start")?.({ prompt: "continue the current task" });
	handlers.get("message_end")?.({
		message: {
			role: "assistant",
			content: [],
			stopReason: "error",
			errorMessage: "temporary provider error",
		},
	});
	handlers.get("message_end")?.({
		message: {
			role: "assistant",
			content: [{ type: "text", text: "Task completed after automatic retry." }],
			stopReason: "stop",
		},
	});

	handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
	await flushUntil(() => Boolean(notifierCall(calls)));

	const call = notifierCall(calls);
	assert.ok(call, "custom Pi notifier should be selected");
	expect(call.args.slice(4, 6)).toEqual(["-message", "Task completed after automatic retry."]);
});

test("/notify-test always delivers, ignoring pane focus", async () => {
	const { calls, commands, ctx } = createLifecycleHarness({ focused: true });
	const command = commands.get("notify-test") as { handler: (args: string, ctx: unknown) => Promise<void> };
	const notices: Array<{ text: string; level: string }> = [];
	const testCtx = { ...ctx, ui: { notify: (text: string, level: string) => notices.push({ text, level }) } };

	await command.handler("", testCtx);

	// The manual test must never consult the focus check nor be suppressed.
	expect(focusCheckCall(calls)).toBeUndefined();
	assert.ok(notifierCall(calls), "notify-test should deliver a notification");
	expect(notices.at(-1)?.level).toBe("info");
});
