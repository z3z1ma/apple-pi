import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Git and repository-copy helpers shared by branch search and the history evaluation. */

export interface GitOptions {
	env?: NodeJS.ProcessEnv;
	/** Written to git's stdin. */
	input?: string;
}

export function git(cwd: string, args: string[], options: GitOptions = {}): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		const child = execFile(
			"git",
			args,
			{
				cwd,
				// No optional locks: status-like reads never refresh the user's index.
				env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", ...options.env },
				maxBuffer: 256 * 1024 * 1024,
			},
			(error, stdout, stderr) => {
				if (error) reject(new Error(`git ${args.join(" ")} failed: ${stderr.trim() || error.message}`));
				else resolvePromise(stdout.trim());
			},
		);
		if (options.input !== undefined) child.stdin?.end(options.input);
	});
}

/** The repository root in the session's spelling of the path, which is the one the model sees. */
export async function repoRoot(cwd: string): Promise<string> {
	return resolve(cwd, await git(cwd, ["rev-parse", "--show-cdup"]));
}

function cloneCommand(source: string, target: string): [string, string[]] {
	// Copy-on-write clones where the filesystem supports them (APFS, btrfs, XFS). On macOS the
	// system cp owns -c; a GNU cp earlier on PATH does not.
	return process.platform === "darwin"
		? ["/bin/cp", ["-cR", source, target]]
		: ["cp", ["-R", "--reflink=auto", source, target]];
}

function run(command: string, args: string[]): Promise<void> {
	return new Promise((resolvePromise, reject) => {
		execFile(command, args, (error, _stdout, stderr) => {
			if (error) reject(new Error(`${command} ${args.join(" ")} failed: ${stderr.trim() || error.message}`));
			else resolvePromise();
		});
	});
}

/** Clone each listed ignored directory of `root` that exists into `path`, unless `path` already has it. */
export async function cloneIgnoredDirs(root: string, path: string, cloneIgnored: string[]): Promise<void> {
	for (const entry of cloneIgnored) {
		const source = join(root, entry);
		const target = join(path, entry);
		if (!existsSync(source) || existsSync(target)) continue;
		mkdirSync(dirname(target), { recursive: true });
		const [command, args] = cloneCommand(source, target);
		await run(command, args);
	}
}
