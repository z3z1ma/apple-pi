import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export interface RalphRoots {
	workspaceRoot: string;
	ledgerRoot: string;
}

function gitOutput(cwd: string, args: string[]): string {
	try {
		return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	} catch {
		throw new Error(`Ralph root is not an accessible Git worktree: ${cwd}`);
	}
}

function inputPath(sessionRoot: string, input?: string): string {
	return realpathSync(input ? (isAbsolute(input) ? input : resolve(sessionRoot, input)) : sessionRoot);
}

export function gitWorktreeRoot(input: string): string {
	const path = realpathSync(input);
	return realpathSync(gitOutput(path, ["rev-parse", "--show-toplevel"]));
}

export function gitCommonDirectory(worktreeRoot: string): string {
	const common = gitOutput(worktreeRoot, ["rev-parse", "--git-common-dir"]);
	return realpathSync(isAbsolute(common) ? common : resolve(worktreeRoot, common));
}

export function isLinkedCheckout(sessionRootInput: string, targetRootInput: string): boolean {
	try {
		const sessionRoot = gitWorktreeRoot(realpathSync(sessionRootInput));
		const targetRoot = gitWorktreeRoot(realpathSync(targetRootInput));
		return gitCommonDirectory(sessionRoot) === gitCommonDirectory(targetRoot);
	} catch {
		return false;
	}
}

export function resolveRalphRoots(sessionRootInput: string, workspaceInput?: string, ledgerInput?: string): RalphRoots {
	const sessionRoot = gitWorktreeRoot(inputPath(realpathSync(sessionRootInput)));
	const workspaceRoot = gitWorktreeRoot(inputPath(sessionRoot, workspaceInput));
	const ledgerRoot = gitWorktreeRoot(inputPath(sessionRoot, ledgerInput ?? workspaceInput));
	const expectedCommonDirectory = gitCommonDirectory(sessionRoot);
	for (const [label, root] of [
		["workspace", workspaceRoot],
		["ledger", ledgerRoot],
	] as const) {
		if (gitCommonDirectory(root) !== expectedCommonDirectory) {
			throw new Error(`Ralph ${label} root is not a linked worktree of the trusted session repository: ${root}`);
		}
	}
	return { workspaceRoot, ledgerRoot };
}
