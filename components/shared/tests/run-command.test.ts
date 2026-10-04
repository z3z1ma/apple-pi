import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { OUTPUT_TAIL_BYTES, runCommand } from "../src/run-command.js";

describe("runCommand", () => {
	const alive = (pid: number) => {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	};
	const gone = async (pid: number) => {
		for (let i = 0; i < 50 && alive(pid); i++) await new Promise((resolve) => setTimeout(resolve, 20));
		return !alive(pid);
	};

	it("kills what a command left running in its process group when it settles", async () => {
		for (const command of [
			"sleep 20 </dev/null >/dev/null 2>&1 & echo $!",
			"sleep 20 </dev/null >/dev/null 2>&1 & echo $!; exit 3",
		]) {
			const result = await runCommand(command, tmpdir(), {});
			const pid = Number(result.stdout.trim().split("\n").at(-1));
			expect(pid).toBeGreaterThan(0);
			expect(await gone(pid)).toBe(true);
		}
	});

	it("kills the process group on timeout", async () => {
		const result = await runCommand(
			"sleep 20 </dev/null >/dev/null 2>&1 & echo $!; sleep 20",
			tmpdir(),
			{},
			{ timeoutSec: 0.5 },
		);
		expect(result.timedOut).toBe(true);
		expect(await gone(Number(result.stdout.trim()))).toBe(true);
	});

	it("kills at once when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const started = Date.now();
		await runCommand("sleep 20", tmpdir(), {}, { signal: controller.signal });
		expect(Date.now() - started).toBeLessThan(5000);
	});

	it("keeps only the last 64 KiB of stdout and stderr", async () => {
		const result = await runCommand(
			"head -c 200000 /dev/zero | tr '\\0' a; printf END; head -c 200000 /dev/zero | tr '\\0' b >&2; printf END >&2",
			tmpdir(),
			{},
		);
		expect(result.stdout.length).toBe(OUTPUT_TAIL_BYTES);
		expect(result.stdout.endsWith("aaaEND")).toBe(true);
		expect(result.stderr.length).toBe(OUTPUT_TAIL_BYTES);
		expect(result.stderr.endsWith("bbbEND")).toBe(true);
	});
});
