import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import { statePaths } from "../src/paths.js";
import { stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
afterAll(() => stopRuntime(state));

test("runtimes started at the same moment leave exactly one running", async () => {
	const main = new URL("../src/runtime-main.ts", import.meta.url).pathname;
	const register = new URL("../src/register.mjs", import.meta.url).href;
	const exits = Array.from({ length: 4 }, () => {
		const child = spawn(process.execPath, ["--import", register, main], { stdio: "ignore", env: process.env });
		return new Promise<number | null>((done) => {
			child.on("exit", (code) => done(code));
			setTimeout(() => done(null), 4000); // still running after four seconds
		});
	});
	const codes = await Promise.all(exits);
	expect(codes.filter((code) => code === null)).toHaveLength(1);
	expect(codes.filter((code) => code === 0)).toHaveLength(3);
	expect(existsSync(state.pidPath)).toBe(true);
}, 15000);

test("PI_CODING_AGENT_DIR resolves like Pi's: a leading ~ is the home directory", () => {
	vi.stubEnv("PI_CODING_AGENT_DIR", "~/.pi-custom");
	expect(statePaths().dir).toBe(join(homedir(), ".pi-custom", "state"));
	vi.stubEnv("PI_CODING_AGENT_DIR", "relative/agent");
	expect(statePaths().dir).toBe(join(resolve("relative/agent"), "state"));
	vi.stubEnv("PI_CODING_AGENT_DIR", state.agentDir);
});
