import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Marks resource loading/session construction performed for a subagent. This is
 * async-context-local so concurrent top-level extension work is unaffected.
 *
 * Stored on globalThis so every module graph (vitest, Pi's extension loader,
 * child sessions) shares one ALS. A per-module instance would make
 * `inChildSessionContext()` miss `runInChildSessionContext()` from another copy.
 */
const KEY = Symbol.for("apple-pi.child-session-als");
const globalScope = globalThis as Record<PropertyKey, unknown>;
let shared = globalScope[KEY] as AsyncLocalStorage<boolean> | undefined;
if (!shared) {
	shared = new AsyncLocalStorage<boolean>();
	globalScope[KEY] = shared;
}
const childSessionContext = shared;

export function inChildSessionContext(): boolean {
	return childSessionContext.getStore() === true;
}

export function runInChildSessionContext<T>(fn: () => T): T {
	return childSessionContext.run(true, fn);
}
