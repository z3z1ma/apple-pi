import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Marks resource loading/session construction performed for a subagent. This is
 * async-context-local so concurrent top-level extension work is unaffected. The
 * stored value is the id of the session that started the subagent, or `true`
 * when the caller did not name one.
 *
 * Stored on globalThis so every module graph (vitest, Pi's extension loader,
 * child sessions) shares one ALS. A per-module instance would make
 * `inChildSessionContext()` miss `runInChildSessionContext()` from another copy.
 */
const KEY = Symbol.for("apple-pi.child-session-als");
const globalScope = globalThis as Record<PropertyKey, unknown>;
let shared = globalScope[KEY] as AsyncLocalStorage<true | string> | undefined;
if (!shared) {
	shared = new AsyncLocalStorage<true | string>();
	globalScope[KEY] = shared;
}
const childSessionContext = shared;

export function inChildSessionContext(): boolean {
	return childSessionContext.getStore() !== undefined;
}

/** The id of the session that started the subagent being loaded, when known. */
export function childSessionParent(): string | undefined {
	const store = childSessionContext.getStore();
	return typeof store === "string" ? store : undefined;
}

export function runInChildSessionContext<T>(fn: () => T, parentSessionId?: string): T {
	return childSessionContext.run(parentSessionId ?? true, fn);
}
