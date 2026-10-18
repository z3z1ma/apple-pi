import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import registerTmuxSessions from "../src/index.js";

const dir = mkdtempSync(join(tmpdir(), "pi-tmux-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function flushUntil(predicate: () => boolean): Promise<void> {
	await vi.waitFor(() => expect(predicate()).toBe(true));
}

/** A fake Pi in a tmux pane whose tty is a temporary file; records every exec. */
function startPi(
	options: { platform?: NodeJS.Platform; server?: Map<string, string>; notch?: () => Promise<unknown> } = {},
) {
	const tty = join(dir, `tty-${Math.random()}`);
	writeFileSync(tty, "");
	const server = options.server ?? new Map<string, string>();
	const execs: string[][] = [];
	const handlers = new Map<string, (...args: unknown[]) => unknown>();
	const pi = {
		on: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler),
		async exec(command: string, args: string[]) {
			execs.push([command, ...args]);
			if (command.endsWith("notch.sh")) return options.notch ? options.notch() : { code: 0, stdout: "", stderr: "" };
			if (args[0] === "display-message") return { code: 0, stdout: `${tty}\n`, stderr: "" };
			if (args[0] === "show-option") return { code: 0, stdout: `${server.get(args[2]) ?? ""}\n`, stderr: "" };
			if (args[0] === "set-option") server.set(args[2], args[3]);
			return { code: 0, stdout: "", stderr: "" };
		},
	};
	const platform = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
	vi.stubEnv("TMUX_PANE", "%7");
	Object.defineProperty(process, "platform", { value: options.platform ?? "linux" });
	try {
		registerTmuxSessions(pi as never);
		handlers.get("session_start")?.({ reason: "startup" }, { mode: "tui", isIdle: () => true });
	} finally {
		Object.defineProperty(process, "platform", platform);
	}
	const settle = (idle = true) => handlers.get("agent_settled")?.({ type: "agent_settled" }, { isIdle: () => idle });
	return { tty, server, execs, settle };
}

test("loads the tmux plugin once per tmux server and tells it where Pi keeps its state", async () => {
	vi.stubEnv("PI_CODING_AGENT_DIR", join(dir, "agent"));
	const first = startPi();
	await flushUntil(() => first.server.has("@pi_sessions_plugin"));
	const second = startPi({ server: first.server });
	await new Promise((resolve) => setTimeout(resolve, 50));
	const runs = [...first.execs, ...second.execs].filter((exec) => exec[1] === "run-shell");
	expect(runs).toEqual([
		["tmux", "run-shell", expect.stringMatching(/components\/tmux-sessions\/pi_session_manager\.tmux$/)],
	]);
	expect(first.server.get("@pi_agent_dir")).toBe(join(dir, "agent"));
});

test("a run that settles idle rings the pane's bell, unless the bell is off or the session is still busy", async () => {
	const pi = startPi();
	await pi.settle();
	await pi.settle(false);
	expect(readFileSync(pi.tty, "utf8")).toBe("\x07");
	vi.stubEnv("PI_TMUX_SESSION_BELL", "off");
	await pi.settle();
	expect(readFileSync(pi.tty, "utf8")).toBe("\x07");
	vi.stubEnv("PI_TMUX_SESSION_BELL", "");
});

test("each root Pi session start in tmux starts the notch panel on macOS and nowhere else, and a failing start breaks nothing", async () => {
	const mac = startPi({ platform: "darwin" });
	const linux = startPi({ platform: "linux" });
	const failing = startPi({
		platform: "darwin",
		notch: async () => {
			throw new Error("swiftc crashed");
		},
	});
	const notchStarts = (execs: string[][]) => execs.filter((exec) => exec[0].endsWith("scripts/notch.sh"));
	expect(notchStarts(mac.execs)).toEqual([[expect.stringMatching(/scripts\/notch\.sh$/), "start"]]);
	expect(notchStarts(linux.execs)).toEqual([]);
	await failing.settle();
	await vi.waitFor(() => expect(readFileSync(failing.tty, "utf8")).toBe("\x07"));
});
