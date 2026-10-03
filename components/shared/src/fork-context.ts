import { AsyncLocalStorage } from "node:async_hooks";

/** A fork's own copy of the repository, and the parent workspace whose paths map onto it. */
export interface ForkWorktree {
	readonly root: string;
	readonly parentRoot: string;
}

interface ForkContext {
	readonly worktree?: ForkWorktree;
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

/** The worktree root of the fork whose tool is running, if that fork is bound to one. */
export function forkWorktreeRoot(): string | undefined {
	return forkScope.getStore()?.worktree?.root;
}
