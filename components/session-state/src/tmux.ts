import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

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
	startCommand: string;
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
	"pane_start_command",
];
const SEP = "\t";
const FORMAT = FIELDS.map((field) => `#{${field}}`).join(SEP);

export function canonicalSocket(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

export function socketDir(): string {
	return join(process.env.TMUX_TMPDIR || "/tmp", `tmux-${process.getuid?.() ?? 0}`);
}

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
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	return found;
}

function noServer(stderr: string): boolean {
	return /no server running|error connecting to .*\((No such file or directory|Connection refused)\)/i.test(stderr);
}

export async function listPanes(
	socket: string,
	options: { timeout: number; signal: AbortSignal },
): Promise<PaneRow[] | "absent"> {
	let stdout: string;
	try {
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
				startCommand: v[12],
			};
		});
}

export async function listClients(
	socket: string,
	options: { timeout: number; signal: AbortSignal },
): Promise<{ name: string; pane: string }[]> {
	let stdout: string;
	try {
		({ stdout } = await run("tmux", ["-S", socket, "list-clients", "-F", `#{client_name}${SEP}#{pane_id}`], {
			encoding: "utf8",
			signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeout)]),
		}));
	} catch (error) {
		if (noServer(String((error as { stderr?: string }).stderr ?? ""))) return [];
		throw error;
	}
	return stdout
		.split("\n")
		.filter((line) => line.includes(SEP))
		.map((line) => {
			const [name, pane] = line.split(SEP);
			return { name, pane };
		});
}

export async function setServerOptions(
	socket: string,
	options: Record<string, string>,
	clients: string[],
	signal: AbortSignal,
): Promise<void> {
	const commands = [
		...Object.entries(options).map(([name, value]) => ["set-option", "-g", name, value]),
		...clients.map((client) => ["refresh-client", "-S", "-t", client]),
	];
	await run("tmux", ["-S", socket, ...commands.flatMap((command, index) => (index ? [";", ...command] : command))], {
		encoding: "utf8",
		signal,
	});
}

export async function killPane(socket: string, pane: string, pid: number, signal: AbortSignal): Promise<void> {
	try {
		await run(
			"tmux",
			[
				"-S",
				socket,
				"if-shell",
				"-F",
				"-t",
				pane,
				`#{&&:#{pane_dead},#{==:#{pane_pid},${pid}}}`,
				`kill-pane -t ${JSON.stringify(pane)}`,
			],
			{ encoding: "utf8", signal },
		);
	} catch (error) {
		const stderr = String((error as { stderr?: string }).stderr ?? "");
		if (!noServer(stderr) && !/can't find pane/i.test(stderr)) throw error;
	}
}

export async function openWindow(
	socket: string,
	pane: string,
	window: { cwd: string; name?: string; command: string[]; env?: Record<string, string> },
	signal: AbortSignal,
): Promise<string> {
	const { stdout: target } = await run("tmux", ["-S", socket, "display-message", "-p", "-t", pane, "#{window_id}"], {
		encoding: "utf8",
		signal,
	});
	const { stdout } = await run(
		"tmux",
		[
			"-S",
			socket,
			"new-window",
			"-a",
			"-d",
			"-P",
			"-F",
			"#{pane_id}",
			"-t",
			target.trim(),
			"-c",
			window.cwd,
			...(window.name ? ["-n", window.name] : []),
			...Object.entries(window.env ?? {}).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
			...window.command,
		],
		{ encoding: "utf8", signal },
	);
	return stdout.trim();
}
