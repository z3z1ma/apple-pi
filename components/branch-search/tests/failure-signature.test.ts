import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { inForkedContinuation } from "../../shared/src/fork-context.js";
import { startFork } from "../../shared/src/forked-continuation.js";
import { createBackgroundTaskBashTool } from "../../tasks/src/bash-tool.js";
import registerTasks from "../../tasks/src/index.js";
import { TaskManager } from "../../tasks/src/task-manager.js";
import {
	FailureCounter,
	failureLine,
	failureSignature,
	normalizeCommand,
	normalizeLine,
	shellOutcome,
} from "../src/failure-signature.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose();
});

function bash(command: string, id: string) {
	return fauxAssistantMessage(fauxToolCall("bash", { command, verbatim: true }, { id }), { stopReason: "toolUse" });
}

describe("failure signature", () => {
	it("collapses whitespace in the command", () => {
		expect(normalizeCommand("  npm   test\n\t-- foo ")).toBe("npm test -- foo");
	});

	it("takes the first line naming an error, else the last non-empty line", () => {
		expect(failureLine("compiling\nTypeError: x is undefined\nAssertionError: y\n")).toBe("TypeError: x is undefined");
		expect(failureLine("one\ntwo\n\n  \n")).toBe("two");
		expect(failureLine("")).toBe("");
	});

	it("replaces absolute paths with basenames, digit runs and long hex runs with #", () => {
		expect(normalizeLine("FAIL /Users/me/repo/src/app.test.ts:42:7 expected 12 got 13")).toBe(
			"FAIL app.test.ts:#:# expected # got #",
		);
		expect(normalizeLine("panic at 0x7ffd5a3b2c10 in commit a1b2c3d4e5")).toBe("panic at # in commit #");
		// Hex runs embedded in identifiers go too; shorter hex-looking words stay.
		expect(normalizeLine("tmp_deadbeef42z bad cafe")).toBe("tmp_#z bad cafe");
	});

	it("gives one signature for the same failure at a different line number", () => {
		const at = (line: number) =>
			failureSignature({
				command: "npm  test",
				exitCode: 1,
				output: `running\nError: expected 2 at /tmp/x/app.ts:${line}:3\n`,
			});
		expect(at(10)).toBe(at(97));
		expect(at(10)).toMatch(/^[0-9a-f]{64}$/);
		expect(failureSignature({ command: "npm test", exitCode: 2, output: "Error: expected 2 at app.ts:1:1" })).not.toBe(
			at(10),
		);
	});

	it("reads the exit code and output of a shell result, and ignores results without one", () => {
		const text = (value: string) => [{ type: "text" as const, text: value }];
		expect(
			shellOutcome("bash", { command: "npm test" }, { content: text("Error: x\n\nCommand exited with code 1") }, true),
		).toEqual({ command: "npm test", exitCode: 1, output: "Error: x" });
		// The command as the model wrote it, before RTK rewrote it.
		expect(
			shellOutcome("bash", { command: "rtk npm test", _rawCommand: "npm test" }, { content: text("ok") }, false),
		).toEqual({ command: "npm test", exitCode: 0, output: "ok" });
		// Pi's own shell tools report a structured exit code.
		expect(
			shellOutcome(
				"powershell",
				{ command: "Invoke-Pester" },
				{ content: text("x"), structuredContent: { output: "Failed: 1", exit_code: 1 } },
				true,
			),
		).toEqual({ command: "Invoke-Pester", exitCode: 1, output: "Failed: 1" });
		// A timeout or a blocked call has no exit code; other tools have no command.
		expect(
			shellOutcome("bash", { command: "sleep 9" }, { content: text("Command timed out after 1 seconds") }, true),
		).toBeUndefined();
		expect(shellOutcome("read", { path: "x" }, { content: text("Command exited with code 1") }, true)).toBeUndefined();
	});

	it("reads the status line only from the end of an error result, and never from successful output", () => {
		const text = (value: string) => [{ type: "text" as const, text: value }];
		// A successful run whose output quotes the status line is still a success.
		expect(
			shellOutcome("bash", { command: "cat log" }, { content: text("Command exited with code 1\nall good") }, false),
		).toEqual({ command: "cat log", exitCode: 0, output: "Command exited with code 1\nall good" });
		expect(
			shellOutcome("bash", { command: "cat log" }, { content: text("x\n\nCommand exited with code 1") }, false),
		).toMatchObject({ exitCode: 0 });
		// An error result whose status line is not the trailing one has no exit code.
		expect(
			shellOutcome(
				"bash",
				{ command: "sleep 9" },
				{ content: text("Command exited with code 2\n\nCommand timed out after 1 seconds") },
				true,
			),
		).toBeUndefined();
		// The surprise note apple-pi's bash adds after the status line keeps the status line trailing.
		expect(
			shellOutcome(
				"bash",
				{ command: "npm test", expect: "success" },
				{
					content: text(
						"Error: x\n\nCommand exited with code 3\n\nSurprise: you predicted this command would succeed.",
					),
				},
				true,
			),
		).toEqual({ command: "npm test", exitCode: 3, output: "Error: x" });
		// A structured exit status wins over the text.
		expect(
			shellOutcome(
				"bash",
				{ command: "npm test" },
				{ content: text("x\n\nCommand exited with code 1"), structuredContent: { output: "x", exit_code: 2 } },
				true,
			),
		).toEqual({ command: "npm test", exitCode: 2, output: "x" });
	});
});

describe("background acknowledgements", { timeout: 30_000 }, () => {
	const managers: TaskManager[] = [];
	afterEach(() => {
		for (const manager of managers.splice(0)) manager.reset();
	});

	it("are not exits: a background start and a Ctrl+B detach keep the command's failure history", async () => {
		const manager = new TaskManager();
		managers.push(manager);
		const bashTool = createBackgroundTaskBashTool(manager);
		const command = "sleep 0.5; echo 'Error: boom'; exit 1";
		const counter = new FailureCounter();
		counter.record({ command, exitCode: 1, output: "Error: boom" });
		counter.record({ command, exitCode: 1, output: "Error: boom" });

		const started = await bashTool.execute("bg-1", { command, run_in_background: true }, undefined, undefined, {
			cwd: process.cwd(),
		} as never);
		expect(started.details).toMatchObject({ backgrounded: true, status: "running" });

		let press: ((data: string) => unknown) | undefined;
		const ui = {
			onTerminalInput: (handler: (data: string) => unknown) => {
				press = handler;
				return () => {
					press = undefined;
				};
			},
			notify: () => undefined,
		};
		const running = bashTool.execute("fg-1", { command }, undefined, undefined, { cwd: process.cwd(), ui } as never);
		await new Promise((resolve) => setTimeout(resolve, 100));
		press?.("\x02");
		const detached = await running;
		expect(detached.details).toMatchObject({ backgrounded: true, status: "running" });

		for (const result of [started, detached]) {
			const outcome = shellOutcome("bash", { command }, result, false);
			if (outcome) counter.record(outcome);
			expect(outcome).toBeUndefined();
			// Either marker alone is enough.
			const { backgrounded: _, ...running } = result.details as Record<string, unknown>;
			expect(shellOutcome("bash", { command }, { ...result, details: running }, false)).toBeUndefined();
			expect(shellOutcome("bash", { command }, { ...result, details: { backgrounded: true } }, false)).toBeUndefined();
		}
		expect(counter.reached(2)).toHaveLength(1);
	});
});

describe("failure counter", () => {
	const failing = (output: string) => ({ command: "npm test", exitCode: 1, output });

	it("counts repeats of one signature and reports it at the threshold", () => {
		const counter = new FailureCounter();
		expect(counter.record(failing("Error at line 3"))?.count).toBe(1);
		expect(counter.record(failing("Error at line 9"))?.count).toBe(2);
		expect(counter.reached(3)).toEqual([]);
		const third = counter.record(failing("Error at line 4"));
		expect(third?.count).toBe(3);
		expect(counter.reached(3)).toEqual([{ signature: third?.signature, command: "npm test", count: 3 }]);
	});

	it("clears every signature of a command when it later exits 0", () => {
		const counter = new FailureCounter();
		counter.record(failing("Error one"));
		counter.record(failing("Error two"));
		counter.record({ command: "npm run lint", exitCode: 1, output: "Error lint" });
		counter.record({ command: "npm run lint", exitCode: 1, output: "Error lint" });
		expect(counter.record({ command: "npm   test", exitCode: 0, output: "ok" })).toBeUndefined();
		expect(counter.reached(1).map((entry) => entry.command)).toEqual(["npm run lint"]);
		expect(counter.record(failing("Error one"))?.count).toBe(1);
	});
});

interface Seen {
	event: ToolResultEvent;
	inFork: boolean;
}

function outcomeOf({ event }: Seen) {
	return shellOutcome(event.toolName, event.input, event, event.isError);
}

describe("V5: tool results with exit code and output", { timeout: 30_000 }, () => {
	it("the tool_result event carries the command, the exit status line, and the output, in root runs and in forks", async () => {
		const seen: Seen[] = [];
		const listen = (pi: ExtensionAPI) => {
			pi.on("tool_result", (event) => {
				seen.push({ event, inFork: inForkedContinuation() });
			});
		};
		const replies = [
			bash("echo out; echo 'Error: boom' >&2; exit 3", "root-fail"),
			bash("echo fine", "root-ok"),
			fauxAssistantMessage("root done"),
			bash("exit 4", "fork-fail"),
			fauxAssistantMessage("fork done"),
		];
		const run = await fauxSession([registerTasks, listen], replies, ["bash"]);
		cleanup.push(run.dispose);
		await run.session.prompt("Run it.");
		const fork = startFork(run.session, {
			messages: run.session.sessionManager.buildSessionProjection().messages,
			append: { role: "custom", customType: "test", content: "Fork.", display: false, timestamp: Date.now() },
			label: "test",
		});
		await fork.result;

		expect(seen).toHaveLength(3);
		const [fail, ok, forked] = seen as [Seen, Seen, Seen];
		expect(fail.inFork).toBe(false);
		expect(fail.event).toMatchObject({ toolName: "bash", isError: true });
		const failText = (fail.event.content[0] as { text: string }).text;
		expect(failText).toContain("out\nError: boom");
		expect(failText).toMatch(/Command exited with code 3$/);
		expect(outcomeOf(fail)).toEqual({
			command: "echo out; echo 'Error: boom' >&2; exit 3",
			exitCode: 3,
			output: expect.stringContaining("Error: boom"),
		});
		expect(ok.inFork).toBe(false);
		expect(outcomeOf(ok)).toEqual({ command: "echo fine", exitCode: 0, output: "fine" });
		// Forks run their tools through the parent's hooks, inside the fork's scope.
		expect(forked.inFork).toBe(true);
		expect(outcomeOf(forked)).toMatchObject({ command: "exit 4", exitCode: 4 });
	});
});
