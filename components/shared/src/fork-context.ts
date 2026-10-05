import { AsyncLocalStorage } from "node:async_hooks";

/**
 * A fork's own copy of the repository, the parent workspace whose paths map onto it, and the fork's
 * private temporary directory: outside every worktree, created when the fork starts and deleted when
 * it settles.
 */
export interface ForkWorktree {
	readonly root: string;
	readonly parentRoot: string;
	readonly tmp: string;
}

interface ForkContext {
	/** The session whose tools the fork reuses, so its trackers can distinguish real child sessions. */
	readonly sessionId: string;
	/** The fork's working directory, when it is bound to a worktree. */
	readonly cwd?: string;
	/** Process groups the fork's shell started; the fork kills them when it settles. */
	readonly processGroups?: Set<number>;
	/** The fork's private temporary directory, when it is bound to a worktree. */
	readonly tmp?: string;
}

// Shared through globalThis so every module copy (reloads, tests, child loaders) sees one scope.
const SCOPE_KEY = Symbol.for("apple-pi.fork-context");
const globalScope = globalThis as Record<PropertyKey, unknown>;
globalScope[SCOPE_KEY] ??= new AsyncLocalStorage<ForkContext>();
const forkScope = globalScope[SCOPE_KEY] as AsyncLocalStorage<ForkContext>;

export function runInFork<T>(context: ForkContext, run: () => T): T {
	return forkScope.run(context, run);
}

/** A fork scope remains inherited for isolation; trackers can limit the check to their own session. */
export function inForkedContinuation(sessionId?: string): boolean {
	const scope = forkScope.getStore();
	return scope !== undefined && (sessionId === undefined || scope.sessionId === sessionId);
}

/** The working directory of the fork whose tool is running, if that fork is bound to a worktree. */
export function forkCwd(): string | undefined {
	return forkScope.getStore()?.cwd;
}

/** The private temporary directory of the fork whose tool is running, if that fork is bound to a worktree. */
export function forkTmpDir(): string | undefined {
	return forkScope.getStore()?.tmp;
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
