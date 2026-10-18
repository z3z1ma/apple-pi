import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * One row of `list-panes -a`: a pane as seen through one session. A window linked into several sessions
 * appears once per session. Ids are only unique within a server.
 */
export interface PaneRow {
	sessionId: string;
	sessionName: string;
	windowId: string;
	windowIndex: number;
	windowName: string;
	paneId: string;
	tty: string;
	pid: number;
	command: string;
	path: string;
	active: number;
	dead: number;
}

const FIELDS = [
	"session_id",
	"session_name",
	"window_id",
	"window_index",
	"window_name",
	"pane_id",
	"pane_tty",
	"pane_pid",
	"pane_current_command",
	"pane_current_path",
	"pane_active",
	"pane_dead",
];
// tmux prints a tab written in the format as is, but escapes control characters inside values (a tab in a
// session name comes out as \011), so a tab cannot appear inside a field.
const SEP = "\t";
const FORMAT = FIELDS.map((field) => `#{${field}}`).join(SEP);

/** One path per socket: macOS reaches `/tmp` through `/private/tmp`, and tmux reports the resolved path. */
export function canonicalSocket(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

/** The directory where tmux keeps this user's server sockets, by tmux's own rule. */
export function socketDir(): string {
	return join(process.env.TMUX_TMPDIR || "/tmp", `tmux-${process.getuid?.() ?? 0}`);
}

/** Socket files in the tmux socket directory; a file may be stale, which `listPanes` reveals. */
export async function socketFiles(): Promise<string[]> {
	const dir = canonicalSocket(socketDir());
	let names: string[];
	try {
		names = await readdir(dir);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const found: string[] = [];
	for (const name of names) {
		const path = join(dir, name);
		try {
			if ((await lstat(path)).isSocket()) found.push(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; // removed while we looked
		}
	}
	return found;
}

/** tmux's own words for "nothing listens on this socket": a stale file, or no file at all. */
function noServer(stderr: string): boolean {
	return /no server running|error connecting to .*\((No such file or directory|Connection refused)\)/i.test(stderr);
}

/**
 * Every pane row of the server at `socket`, or "absent" when tmux says no server is there. Any other failure
 * (a timeout, no permission, no tmux) throws: it proves nothing about the server.
 */
export async function listPanes(
	socket: string,
	options: { timeout: number; signal: AbortSignal },
): Promise<PaneRow[] | "absent"> {
	let stdout: string;
	try {
		// A deadline through an abort signal, not execFile's `timeout`: a tmux client killed on timeout exits 0
		// with no output, which would read as a server with no panes. An aborted call always rejects.
		({ stdout } = await run("tmux", ["-S", socket, "list-panes", "-a", "-F", FORMAT], {
			encoding: "utf8",
			signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeout)]),
		}));
	} catch (error) {
		if (noServer(String((error as { stderr?: string }).stderr ?? ""))) return "absent";
		throw error;
	}
	return stdout
		.split("\n")
		.filter((line) => line.includes(SEP))
		.map((line) => {
			const v = line.split(SEP);
			return {
				sessionId: v[0],
				sessionName: v[1],
				windowId: v[2],
				windowIndex: Number(v[3]),
				windowName: v[4],
				paneId: v[5],
				tty: v[6],
				pid: Number(v[7]),
				command: v[8],
				path: v[9],
				active: Number(v[10]),
				dead: Number(v[11]),
			};
		});
}
