import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackgroundTaskBashTool } from "../src/bash-tool.js";
import { createMonitorTool } from "../src/monitor-tool.js";
import { TaskManager } from "../src/task-manager.js";
import { terminalSize } from "../src/terminal.js";
import { terminalShellOperations } from "../src/user-bash.js";

const ESC = "\x1b";
const greenWhenTerminal = `node -e "process.stdout.write(process.stdout.isTTY ? '\\x1b[32mgreen\\x1b[0m\\n' : 'plain\\n')"`;

describe.skipIf(process.platform === "win32")("Bash on a pseudo-terminal", () => {
	const managers: TaskManager[] = [];
	const dirs: string[] = [];

	afterEach(() => {
		for (const manager of managers.splice(0)) manager.reset();
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	function bash(params: Record<string, unknown>) {
		const manager = new TaskManager();
		managers.push(manager);
		return {
			manager,
			result: createBackgroundTaskBashTool(manager).execute(
				"pty-call",
				{ verbatim: true, timeout: 10, ...params } as any,
				undefined,
				undefined,
				{ cwd: process.cwd() } as any,
			),
		};
	}

	const text = (result: { content: Array<{ type: string; text?: string }> }) =>
		result.content.map((block) => block.text ?? "").join("");

	it("gives stdout and stderr a terminal and keeps stdin a pipe", async () => {
		const result = await bash({
			command: "test -t 1 && echo stdout-terminal; test -t 2 && echo stderr-terminal >&2; test -t 0 || echo stdin-pipe",
		}).result;
		expect(text(result)).toBe("stdout-terminal\nstderr-terminal\nstdin-pipe\n");
		expect(result.details.terminalUnavailable).toBeUndefined();
		const piped = await bash({ command: "cat | tr a-z A-Z", stdin: "one\ntwo\n" }).result;
		expect(text(piped)).toBe("ONE\nTWO\n");
	});

	it("lets programs emit their terminal colors, shown in details and kept out of the model's text", async () => {
		const result = await bash({ command: greenWhenTerminal }).result;
		expect(text(result)).toBe("green\n");
		expect(text(result)).not.toContain(ESC);
		expect(result.details.styledOutput).toBe(`${ESC}[32mgreen${ESC}[0m\n`);
	});

	it("keeps colored output in details when the command fails", async () => {
		const result = await bash({ command: `${greenWhenTerminal}; exit 4` }).result;
		expect(result.isError).toBe(true);
		expect(text(result)).toBe("green\n\n\nCommand exited with code 4");
		expect(result.details.styledOutput).toBe(`${ESC}[32mgreen${ESC}[0m\n\n\nCommand exited with code 4`);
	});

	it("describes the terminal size and disables pagers", async () => {
		const { cols, rows } = terminalSize();
		const result = await bash({
			command: `echo "$TERM $PAGER $GIT_PAGER $COLUMNS $LINES"; node -e "console.log(process.stdout.columns, process.stdout.rows)"`,
		}).result;
		expect(text(result)).toBe(`xterm-256color cat cat ${cols} ${rows}\n${cols} ${rows}\n`);
	});

	it("fails prompts that read the terminal directly instead of hanging", async () => {
		const started = Date.now();
		const result = await bash({ command: "read -r answer < /dev/tty; echo status=$?" }).result;
		expect(text(result)).toContain("status=1");
		expect(Date.now() - started).toBeLessThan(5000);
	});

	it("kills the whole process group on timeout", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pty-timeout-"));
		dirs.push(dir);
		const pidFile = join(dir, "pid");
		const result = await bash({ command: `sleep 30 & echo $! > ${pidFile}; sleep 30`, timeout: 1 }).result;
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("Command timed out after 1 seconds");
		const orphan = Number(readFileSync(pidFile, "utf8"));
		await vi.waitFor(() => expect(() => process.kill(orphan, 0)).toThrow());
	});

	it("keeps large output complete and writes the full output as plain text", async () => {
		const result = await bash({ command: "seq 1 200000" }).result;
		expect(result.details.truncated).toBe(true);
		expect(text(result).split("\n\n[Truncated")[0]?.split("\n").slice(-3)).toEqual(["199999", "200000", ""]);
		const full = readFileSync(result.details.fullOutputPath, "utf8");
		expect(full).toBe(`${Array.from({ length: 200000 }, (_, i) => i + 1).join("\n")}\n`);
	});

	it("shows the final state of progress output", async () => {
		const result = await bash({
			command: `node -e "for (const p of [10, 60, 100]) process.stdout.write('\\r\\x1b[Kprogress ' + p + '%'); console.log()"`,
		}).result;
		expect(text(result)).toBe("progress 100%\n");
	});

	it("runs background tasks on a terminal too", async () => {
		const { manager, result } = bash({ command: greenWhenTerminal, run_in_background: true });
		const task = manager.get((await result).details.taskId);
		await vi.waitFor(() => expect(task?.status).toBe("completed"));
		const snapshot = task?.kind === "command" ? task.output.getSnapshot() : undefined;
		expect(snapshot?.content).toBe("green\n");
		expect(snapshot?.styled).toBe(`${ESC}[32mgreen${ESC}[0m\n`);
	});

	it("colors grep as an interactive shell does, and only where its output reaches the terminal", async () => {
		const file = "components/tasks/src/terminal.ts";
		const shown = await bash({ command: `grep -n "export class" ${file}` }).result;
		expect(shown.details.styledOutput).toContain(ESC);
		expect(text(shown)).not.toContain(ESC);
		const piped = await bash({ command: `grep -n "export class" ${file} | cat` }).result;
		expect(piped.details.styledOutput).not.toContain(ESC);
	});

	it("gives nested bash scripts the operator's own BASH_ENV and no color wrappers", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pty-bash-env-"));
		dirs.push(dir);
		const own = join(dir, "env.sh");
		writeFileSync(own, "greet() { echo hello; }\n");
		const nested = "bash -c 'echo $BASH_ENV; type -t greet; type -t grep'";
		const previous = process.env.BASH_ENV;
		try {
			delete process.env.BASH_ENV;
			expect(text(await bash({ command: nested }).result)).toBe("\nfile\n");
			process.env.BASH_ENV = own;
			expect(text(await bash({ command: `greet; ${nested}` }).result)).toBe(`hello\n${own}\nfunction\nfile\n`);
		} finally {
			if (previous === undefined) delete process.env.BASH_ENV;
			else process.env.BASH_ENV = previous;
		}
	});

	it("does not wait for a descendant left running in the background", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pty-background-"));
		dirs.push(dir);
		const pidFile = join(dir, "pid");
		const started = Date.now();
		const result = await bash({ command: `sleep 30 & echo $! > ${pidFile}; echo started` }).result;
		expect(text(result)).toBe("started\n");
		expect(Date.now() - started).toBeLessThan(5000);
		process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL");
	});

	it("runs the operator's ! commands on the terminal, passing final plain lines to Pi", async () => {
		const operations = terminalShellOperations({ cwd: process.cwd() } as any);
		const run = async (command: string, timeout?: number) => {
			const chunks: string[] = [];
			const result = await operations.exec(command, process.cwd(), {
				onData: (data) => chunks.push(data.toString()),
				timeout,
			});
			return { output: chunks.join(""), exitCode: result.exitCode };
		};
		expect(
			await run(`test -t 1 && echo terminal; printf '10%%\\r100%%\\n'; ${greenWhenTerminal}; printf tail`),
		).toEqual({
			output: "terminal\n100%\ngreen\ntail",
			exitCode: 0,
		});
		expect((await run("exit 3")).exitCode).toBe(3);
		await expect(run("sleep 30", 1)).rejects.toThrow("timeout:1");
	});

	it("keeps monitors on pipes so their stdout lines stay plain events", async () => {
		const manager = new TaskManager();
		managers.push(manager);
		const lines: string[] = [];
		manager.onMonitorEvent((event) => lines.push(event.line));
		await createMonitorTool(manager).execute(
			"monitor",
			{ command: "test -t 1 && echo terminal || echo pipe" },
			undefined,
			undefined,
			{ cwd: process.cwd() } as any,
		);
		await vi.waitFor(() => expect(lines).toEqual(["pipe"]));
	});
});
