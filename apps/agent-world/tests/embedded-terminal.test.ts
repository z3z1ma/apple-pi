import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { openEmbeddedTerminals } from "../src/backend/embedded-terminal.js";
import {
	isTerminalClose,
	isTerminalCreate,
	isTerminalResize,
	isTerminalWrite,
	type TerminalEvent,
} from "../src/terminal.js";

let cwd: string;
let terminals: ReturnType<typeof openEmbeddedTerminals>;
let events: TerminalEvent[];
const output = (id: string) =>
	events.flatMap((event) => (event.type === "data" && event.id === id ? [event.data] : [])).join("");
const request = (id = "one") => ({ id, cwd, cols: 80, rows: 24 });
const gone = (pid: number) => {
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ESRCH";
	}
};

beforeEach(() => {
	cwd = realpathSync(mkdtempSync(join(tmpdir(), "embedded-terminal-")));
	vi.stubEnv("SHELL", "/bin/sh");
	vi.stubEnv("HOME", cwd);
	vi.stubEnv("ENV", "");
	terminals = openEmbeddedTerminals();
	events = [];
	terminals.onEvent((event) => events.push(event));
});
afterEach(() => {
	terminals.dispose();
	vi.unstubAllEnvs();
	rmSync(cwd, { recursive: true, force: true });
});

test("a real local shell streams input, ANSI output, resize and natural exit", async () => {
	expect(await terminals.create(request())).toMatchObject({ ok: true, session: { id: "one", cwd, shell: "/bin/sh" } });
	expect(await terminals.resize({ id: "one", cols: 79, rows: 23 })).toEqual({ ok: true });
	expect(await terminals.write({ id: "one", data: "printf '\\033[31mCOLOR\\033[0m\\n'; stty size; exit 7\r" })).toEqual(
		{ ok: true },
	);
	await vi.waitFor(() => expect(events).toContainEqual({ type: "exit", id: "one", exitCode: 7, signal: 0 }), {
		timeout: 5000,
	});
	expect(output("one")).toContain("\u001b[31mCOLOR\u001b[0m");
	expect(output("one")).toContain("\r\n23 79\r\n");
	expect(await terminals.write({ id: "one", data: "ignored" })).toMatchObject({ ok: false });
	expect(await terminals.close({ id: "one" })).toEqual({ ok: true });
});

test.runIf(process.platform === "darwin")(
	"macOS shells load both login and interactive startup from isolated home",
	async () => {
		vi.stubEnv("SHELL", "/bin/zsh");
		vi.stubEnv("ZDOTDIR", cwd);
		writeFileSync(join(cwd, ".zprofile"), "export EMBEDDED_LOGIN_TEST=loaded\n");
		writeFileSync(join(cwd, ".zshrc"), "export EMBEDDED_RC_TEST=loaded\nPROMPT='test> '\n");
		expect(await terminals.create(request())).toMatchObject({ ok: true });
		await terminals.write({
			id: "one",
			data: `printf '__LOGIN__%s__RC__%s\\n' "\${EMBEDDED_LOGIN_TEST:-absent}" "\${EMBEDDED_RC_TEST:-absent}"; exit\r`,
		});
		await vi.waitFor(() => expect(events.some((event) => event.type === "exit")).toBe(true));
		expect(output("one")).toContain("\r\n__LOGIN__loaded__RC__loaded\r\n");
	},
);

test("a new PTY keeps ordinary environment but not the launching terminal identity", async () => {
	for (const key of ["TMUX", "TMUX_PANE", "TERM_SESSION_ID", "TERM_PROGRAM_VERSION"])
		vi.stubEnv(key, "parent-terminal");
	vi.stubEnv("TERM_PROGRAM", "Apple_Terminal");
	vi.stubEnv("EMBEDDED_KEEP", "kept");
	await terminals.create(request());
	await terminals.write({
		id: "one",
		data: `printf '__ENV__%s|%s|%s|%s|%s|%s\\n' "\${TMUX-unset}" "\${TMUX_PANE-unset}" "\${TERM_SESSION_ID-unset}" "\${TERM_PROGRAM_VERSION-unset}" "$TERM_PROGRAM" "$EMBEDDED_KEEP"; exit\r`,
	});
	await vi.waitFor(() => expect(events.some((event) => event.type === "exit")).toBe(true));
	expect(output("one")).toContain("\r\n__ENV__unset|unset|unset|unset|apple-pi|kept\r\n");
});

test("terminal identities retain their original directories and route events independently", async () => {
	const other = join(cwd, "other");
	mkdirSync(other);
	expect(await terminals.create(request("one"))).toMatchObject({ ok: true, session: { cwd } });
	expect(await terminals.create({ ...request("two"), cwd: other })).toMatchObject({
		ok: true,
		session: { cwd: other },
	});
	expect(await terminals.create({ ...request("one"), cwd: other })).toMatchObject({ ok: false });
	await terminals.write({ id: "one", data: "printf 'FIRST\\n'; pwd\r" });
	await terminals.write({ id: "two", data: "printf 'SECOND\\n'; pwd\r" });
	await vi.waitFor(() => {
		expect(output("one")).toContain("\r\nFIRST\r\n");
		expect(output("one")).toContain(`\r\n${cwd}\r\n`);
		expect(output("two")).toContain("\r\nSECOND\r\n");
		expect(output("two")).toContain(`\r\n${other}\r\n`);
	});
	expect(output("two")).not.toContain("FIRST");
	await terminals.close({ id: "one" });
	expect(await terminals.write({ id: "two", data: "printf 'STILL_HERE\\n'\r" })).toEqual({ ok: true });
	await vi.waitFor(() => expect(output("two")).toContain("\r\nSTILL_HERE\r\n"));
});

test.each(["close", "closeAll", "dispose"] as const)(
	"%s hangs up the owned shell and its normal foreground job",
	async (method) => {
		await terminals.create(request());
		await terminals.write({
			id: "one",
			data: "printf '__SHELL__%s\\n' $$; /bin/sh -c 'echo __CHILD__$$; exec /bin/sleep 90'\r",
		});
		let pids: number[] = [];
		await vi.waitFor(() => {
			pids = [...output("one").matchAll(/__(?:SHELL|CHILD)__(\d+)/g)].map((match) => Number(match[1]));
			expect(pids).toHaveLength(2);
		});
		if (method === "close") await terminals.close({ id: "one" });
		else terminals[method]();
		await vi.waitFor(() => expect(pids.every(gone)).toBe(true), { timeout: 5000 });
		expect(await terminals.write({ id: "one", data: "ignored" })).toMatchObject({ ok: false });
	},
);

test("invalid paths and dimensions are rejected", async () => {
	const file = join(cwd, "file");
	writeFileSync(file, "not a directory");
	for (const directory of ["", "relative", file, join(cwd, "missing")])
		expect(await terminals.create({ ...request(), cwd: directory })).toMatchObject({ ok: false });
	for (const cols of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 65536])
		expect(await terminals.create({ ...request(), cols })).toMatchObject({ ok: false });
});

test("IPC shape guards permit only typed identities, text and winsize dimensions", () => {
	expect(isTerminalCreate(request())).toBe(true);
	expect(isTerminalResize({ id: "one", cols: 1, rows: 65535 })).toBe(true);
	expect(isTerminalWrite({ id: "one", data: "" })).toBe(true);
	expect(isTerminalClose({ id: "one" })).toBe(true);
	for (const value of [null, [], {}, { id: 5 }, { id: " " }]) {
		expect(isTerminalCreate(value)).toBe(false);
		expect(isTerminalResize(value)).toBe(false);
		expect(isTerminalWrite(value)).toBe(false);
		expect(isTerminalClose(value)).toBe(false);
	}
	expect(isTerminalWrite({ id: "one", data: 3 })).toBe(false);
});
