import { AsyncLocalStorage } from "node:async_hooks";

/**
 * A fork's own copy of the repository, the parent workspace and ancestor worktrees whose paths map onto it, and the
 * fork's private temporary directory: outside every worktree, created when the fork starts and
 * deleted when it settles.
 */
export interface ForkWorktree {
	readonly root: string;
	readonly parentRoot: string;
	readonly tmp: string;
	/**
	 * Worktree roots of the forks whose conversation this fork continues. Their paths in the
	 * conversation map onto this fork's root, like paths under `parentRoot`.
	 */
	readonly ancestors?: readonly string[];
	/**
	 * Variables the fork's shell commands run with, on top of the process environment and `tmp`;
	 * branch search points git at a private object store with it.
	 */
	readonly env?: Readonly<Record<string, string>>;
}

interface ForkContext {
	/** The fork's working directory, when it is bound to a worktree. */
	readonly cwd?: string;
	/** Process groups the fork's shell started; the fork kills them when it settles. */
	readonly processGroups?: Set<number>;
	/** The fork's private temporary directory, when it is bound to a worktree. */
	readonly tmp?: string;
	/** Extra environment of the fork's shell commands, when its worktree binding sets one. */
	readonly env?: Readonly<Record<string, string>>;
}

// Shared through globalThis so every module copy (reloads, tests, child loaders) sees one scope.
const SCOPE_KEY = Symbol.for("apple-pi.fork-context");
const globalScope = globalThis as Record<PropertyKey, unknown>;
globalScope[SCOPE_KEY] ??= new AsyncLocalStorage<ForkContext>();
const forkScope = globalScope[SCOPE_KEY] as AsyncLocalStorage<ForkContext>;

export function runInFork<T>(context: ForkContext, run: () => T): T {
	return forkScope.run(context, run);
}

/** True while a tool runs for a fork, so trackers of the main run can ignore it. */
export function inForkedContinuation(): boolean {
	return forkScope.getStore() !== undefined;
}

/** The working directory of the fork whose tool is running, if that fork is bound to a worktree. */
export function forkCwd(): string | undefined {
	return forkScope.getStore()?.cwd;
}

/** The private temporary directory of the fork whose tool is running, if that fork is bound to a worktree. */
export function forkTmpDir(): string | undefined {
	return forkScope.getStore()?.tmp;
}

/** The extra shell environment of the fork whose tool is running, if its worktree binding sets one. */
export function forkEnv(): Readonly<Record<string, string>> | undefined {
	return forkScope.getStore()?.env;
}

function groupEmpty(pgid: number): boolean {
	try {
		process.kill(-pgid, 0);
		return false;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ESRCH";
	}
}

/**
 * Record a process group the running tool started, so the fork that owns it can kill it on settle.
 * Call the returned function when the group's leader exits: a group with no member left is
 * forgotten at once, so a later kill cannot reach an unrelated group that reused its number.
 */
export function trackForkProcessGroup(pgid: number | undefined): () => void {
	const groups = forkScope.getStore()?.processGroups;
	if (pgid === undefined || !groups) return () => {};
	// Groups that emptied since they were recorded go too, so the set never holds a number for long.
	for (const group of groups) if (groupEmpty(group)) groups.delete(group);
	groups.add(pgid);
	return () => {
		if (groupEmpty(pgid)) groups.delete(pgid);
	};
}
