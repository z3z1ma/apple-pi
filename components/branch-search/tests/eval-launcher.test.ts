import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { validConfig } from "./fixtures.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const launcher = join(repoRoot, "scripts", "eval-run.mjs");
const fakeSessions = fileURLToPath(new URL("./trap-sessions.fixture.ts", import.meta.url));

async function until(condition: () => boolean, timeoutMs: number, output: () => string): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`timed out; output:\n${output()}`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

describe("evaluation launcher", { timeout: 120_000 }, () => {
	it("cancels the trap benchmark on SIGTERM to the command: removes the stage directory, closes the sessions, and writes the partial report", async () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-eval-launcher-")));
		dirs.push(dir);
		const markers = join(dir, "markers");
		mkdirSync(markers);
		const configPath = join(dir, "traps.json");
		const reportPath = join(dir, "report.md");
		writeFileSync(
			configPath,
			JSON.stringify({
				model: "coding",
				traps: ["tags-case-dedupe"],
				runsPerArm: 1,
				concurrency: 1,
				oracle: { timeoutSec: 60 },
				search: { ...validConfig(), scorer: { validationRetries: 1, challengers: 1 } },
			}),
		);
		// The command runs in a clean environment: no state of the Vitest run that hosts this test.
		const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST")));
		const child = spawn(process.execPath, [launcher, "eval/traps.eval.ts"], {
			cwd: repoRoot,
			env: {
				...env,
				BRANCH_SEARCH_TRAPS_CONFIG: configPath,
				BRANCH_SEARCH_TRAPS_OUT: reportPath,
				APPLE_PI_EVAL_SESSIONS_MODULE: fakeSessions,
				TRAP_FIXTURE_MARKERS: markers,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		child.stdout.on("data", (chunk) => {
			output += chunk;
		});
		child.stderr.on("data", (chunk) => {
			output += chunk;
		});
		const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));

		// The alone arm's session holds its first model request open.
		await until(
			() => existsSync(join(markers, "requested")),
			60_000,
			() => output,
		);
		child.kill("SIGTERM");
		const code = await exited;

		expect(code, output).toBe(1);
		const cwds = readFileSync(join(markers, "cwds"), "utf8").trim().split("\n");
		expect(cwds).toHaveLength(1);
		expect(existsSync(cwds[0] as string)).toBe(false);
		expect(existsSync(join(markers, "closed")), output).toBe(true);
		expect(readFileSync(reportPath, "utf8")).toContain("Runs finished: 0 of 3");
	});
});
