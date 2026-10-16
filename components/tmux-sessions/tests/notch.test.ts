import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, test } from "vitest";

const notchDir = fileURLToPath(new URL("../notch/", import.meta.url));
const launcher = fileURLToPath(new URL("../scripts/notch.sh", import.meta.url));
const onMac = process.platform === "darwin";
const hasSwiftc = onMac && spawnSync("/bin/sh", ["-c", "command -v swiftc"]).status === 0;

const scratch = mkdtempSync(join(tmpdir(), "pi-notch-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// The panel is compiled on users' machines at first start, so a shell that no longer compiles must fail here first.
test.skipIf(!hasSwiftc)(
	"the notch shell type-checks",
	() => {
		const result = spawnSync("swiftc", ["-typecheck", join(notchDir, "NotchShell.swift")], { encoding: "utf8" });
		expect(result.status, result.stderr).toBe(0);
	},
	120_000,
);

/** A PATH holding only the tools the launcher needs, so the real `swiftc` (also in /usr/bin on macOS) is absent. */
function toolsPath(): string {
	const tools = join(scratch, "tools");
	mkdirSync(tools, { recursive: true });
	for (const name of ["bash", "dirname", "uname", "date", "mkdir", "shasum", "perl", "cut", "mv", "rm", "nohup"]) {
		const found = spawnSync("/bin/sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).stdout.trim();
		if (found && !existsSync(join(tools, name))) symlinkSync(found, join(tools, name));
	}
	return tools;
}

/** A fake `swiftc` that counts its calls and writes, as the binary, a stub that records the arguments it was launched with. */
function fakeSwiftc(): string {
	const bin = join(scratch, "fake-swiftc");
	mkdirSync(bin, { recursive: true });
	const swiftc = join(bin, "swiftc");
	writeFileSync(
		swiftc,
		[
			"#!/bin/bash",
			'echo call >> "$CALLS"',
			'while [ "$1" != -o ]; do shift; done',
			'printf \'#!/bin/bash\\nprintf "%%s\\\\n" "$@" > "$LAUNCHED"\\n\' > "$2"',
			'/bin/chmod +x "$2"',
		].join("\n"),
	);
	chmodSync(swiftc, 0o755);
	return bin;
}

async function waitFor(path: string): Promise<string> {
	for (let i = 0; i < 100 && !existsSync(path); i++) await new Promise((done) => setTimeout(done, 20));
	return readFileSync(path, "utf8");
}

test.skipIf(!onMac)(
	"notch.sh start builds the shell once per source and launches it with the page, feed, and focus paths",
	async () => {
		const piHome = join(scratch, "built");
		const calls = join(scratch, "calls");
		const launched = join(scratch, "launched");
		const env = {
			PATH: `${fakeSwiftc()}:${toolsPath()}`,
			PI_CODING_AGENT_DIR: piHome,
			CALLS: calls,
			LAUNCHED: launched,
		};

		expect(spawnSync(launcher, ["start"], { env, encoding: "utf8" }).status).toBe(0);
		const paths = (await waitFor(launched)).trim().split("\n");
		expect(paths).toHaveLength(3);
		expect(existsSync(join(paths[0], "index.html"))).toBe(true);
		expect(paths[1].endsWith("agents.py") && existsSync(paths[1])).toBe(true);
		expect(paths[2].endsWith("focus-tmux.sh") && existsSync(paths[2])).toBe(true);
		const binaries = spawnSync("/bin/ls", [join(piHome, "cache", "notch")], { encoding: "utf8" })
			.stdout.trim()
			.split("\n");
		expect(binaries).toHaveLength(1);
		const binary = join(piHome, "cache", "notch", binaries[0]);
		const builtAt = statSync(binary).mtimeMs;

		rmSync(launched);
		expect(spawnSync(launcher, ["start"], { env, encoding: "utf8" }).status).toBe(0);
		await waitFor(launched);
		expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
		expect(statSync(binary).mtimeMs).toBe(builtAt);
	},
);

test.skipIf(!onMac)("notch.sh start without swiftc exits cleanly, logs one line, and launches nothing", () => {
	const piHome = join(scratch, "no-swiftc");
	const result = spawnSync(launcher, ["start"], {
		env: { PATH: toolsPath(), PI_CODING_AGENT_DIR: piHome },
		encoding: "utf8",
	});

	expect(result.status).toBe(0);
	expect(
		readFileSync(join(piHome, "logs", "pi-notch.log"), "utf8")
			.trim()
			.split("\n"),
	).toHaveLength(1);
	expect(existsSync(join(piHome, "cache"))).toBe(false);
});
