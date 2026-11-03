import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface ForkWorktree {
	readonly root: string;
	readonly parentRoot: string;
	readonly tmp: string;
}

interface ForkContext {
	readonly sessionId: string;
	readonly cwd?: string;
	readonly processGroups?: Set<number>;
	readonly tmp?: string;
	readonly messages?: () => readonly AgentMessage[];
}

const SCOPE_KEY = Symbol.for("apple-pi.fork-context");
const globalScope = globalThis as Record<PropertyKey, unknown>;
globalScope[SCOPE_KEY] ??= new AsyncLocalStorage<ForkContext>();
const forkScope = globalScope[SCOPE_KEY] as AsyncLocalStorage<ForkContext>;

export function runInFork<T>(context: ForkContext, run: () => T): T {
	return forkScope.run(context, run);
}

export function inForkedContinuation(sessionId?: string): boolean {
	const scope = forkScope.getStore();
	return scope !== undefined && (sessionId === undefined || scope.sessionId === sessionId);
}

export function forkMessages(sessionId: string): readonly AgentMessage[] | undefined {
	const scope = forkScope.getStore();
	return scope?.sessionId === sessionId ? scope.messages?.() : undefined;
}

export function forkCwd(): string | undefined {
	return forkScope.getStore()?.cwd;
}

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

export function trackForkProcessGroup(pgid: number | undefined): () => void {
	const groups = forkScope.getStore()?.processGroups;
	if (pgid === undefined || !groups) return () => {};
	for (const group of groups) if (groupEmpty(group)) groups.delete(group);
	groups.add(pgid);
	return () => {
		if (groupEmpty(pgid)) groups.delete(pgid);
	};
}
