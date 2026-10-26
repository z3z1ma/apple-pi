import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { managesPeople } from "../../organization/src/install.js";
import { loadRoles } from "../../organization/src/roles.js";
import { statePaths } from "../../session-state/src/paths.js";
import { openPeerProgram, type PeerProgram } from "../../session-state/src/program-client.js";
import { normalizeOutputSchema } from "../../shared/src/structured-output.js";
import { containsContextMarks, fitContext } from "./evidence.js";
import type { Args, HostCallScope } from "./guest-functions.js";
import { serializeJsonValue } from "./json.js";

type RunScope = Pick<HostCallScope, "signal" | "operation" | "changed" | "setChildren" | "claimAgent" | "addUsage">;

interface Handle {
	id: string;
	role?: string;
	controller: AbortController;
	runs: Set<Promise<unknown>>;
	starting?: Promise<void>;
	closing?: Promise<void>;
}

export interface PeerCalls {
	bindings: Record<string, string>;
	create(role: unknown): string;
	run(key: string, args: Args, scope: RunScope): Promise<Args>;
	agent(args: Args, scope: RunScope): Promise<Args>;
	closePeer(key: string): Promise<void>;
	close(): Promise<void>;
}

function requiredText(value: unknown, name: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`Give the peer a non-empty ${name}`);
	return value;
}

function boundSummary(value: unknown): Args {
	try {
		return { bound: true, chars: serializeJsonValue(value, "Bound argument").length };
	} catch {
		return { bound: true };
	}
}

/** Bound data belongs in the task's files, never in an activity row or an operation trace. */
export function peerOperationArgs(args: Args): Args {
	return {
		...Object.fromEntries(["key", "role", "name", "task"].filter((key) => key in args).map((key) => [key, args[key]])),
		...("context" in args ? { context: boundSummary(args.context) } : {}),
		...("outputSchema" in args ? { outputSchema: boundSummary(args.outputSchema) } : {}),
	};
}

function contextFile(person: string, value: unknown): string {
	const db = new DatabaseSync(statePaths().db, { readOnly: true });
	let bundle: string | undefined;
	try {
		bundle = (
			db
				.prepare("select t.bundle from work_tasks t join work_focus f on f.task_id = t.id where f.person = ?")
				.get(person) as { bundle: string } | undefined
		)?.bundle;
	} finally {
		db.close();
	}
	if (!bundle) throw new Error("The temporary peer has no assigned task for its bound context");
	const path = join(bundle, `context-${randomUUID()}.json`);
	writeFileSync(path, serializeJsonValue(value, "Peer context"), { encoding: "utf8", mode: 0o600 });
	return path;
}

/** Invocation-local handles. Python keeps only their keys; this owner keeps and disposes the actual resources. */
export function createPeerCalls(ctx: ExtensionToolContext, attachments: Record<string, string> = {}): PeerCalls {
	const canManage = managesPeople(ctx);
	if (!canManage && Object.keys(attachments).length) throw new Error("Peer delegation requires a managing role");
	const caller = ctx.sessionManager?.getSessionId();
	const cwd = ctx.cwd;
	const handles = new Map<string, Handle>();
	const lifetime = new AbortController();
	const attached = new Map<string, string>();
	const agents = new Set<Promise<Args>>();
	let program: Promise<PeerProgram> | undefined;
	let ending: Promise<void> | undefined;
	let closing = false;

	const put = (id: string, role?: string): string => {
		const key = randomUUID();
		handles.set(key, { id, role, controller: new AbortController(), runs: new Set() });
		return key;
	};
	const bindings = Object.fromEntries(
		Object.entries(attachments).map(([name, id]) => {
			let key = attached.get(id);
			if (!key) {
				key = put(id);
				attached.set(id, key);
			}
			return [name, key];
		}),
	);
	const get = (key: string): Handle => {
		const handle = handles.get(key);
		if (!handle) throw new Error("This peer handle belongs to another pi_exec execution; attach or create it again");
		return handle;
	};
	const open = (signal: AbortSignal): Promise<PeerProgram> => {
		signal.throwIfAborted();
		if (closing) throw new Error("This program is closing its peers");
		if (!caller) throw new Error("Peer calls require a Pi session id");
		program ??= openPeerProgram(caller, lifetime.signal);
		return program;
	};
	const create = (role: unknown): string => {
		if (!canManage) throw new Error("Peer creation requires a managing role");
		if (closing) throw new Error("This program is closing its peers");
		const name = requiredText(role, "catalog role");
		const catalog = loadRoles(cwd);
		if (!catalog.roles.has(name))
			throw new Error(`Unknown role: ${name}. Available roles: ${[...catalog.roles.keys()].join(", ")}`);
		return put(randomUUID(), name);
	};
	const perform = async (handle: Handle, args: Args, scope: RunScope): Promise<Args> => {
		if (closing || handle.closing) throw new Error("This peer handle is closed");
		if (handle.id === caller) throw new Error("A program cannot attach its own session; ask another colleague");
		const task = requiredText(args.task, "task");
		scope.operation.args.peer = handle.id;
		if (handle.role) scope.operation.args.role = handle.role;
		const outputSchema = args.outputSchema === undefined ? undefined : normalizeOutputSchema(args.outputSchema);
		const context = containsContextMarks(args.context) ? fitContext(args.context) : undefined;
		const signal = AbortSignal.any([scope.signal, handle.controller.signal]);
		signal.throwIfAborted();
		scope.claimAgent();
		const owner = await open(signal);
		signal.throwIfAborted();
		if (handle.role) {
			handle.starting ??= (async () => {
				const receipt = await owner.command(
					handle.id,
					{
						kind: "start",
						role: handle.role,
						goal: { by: caller!, text: task },
					},
					{ signal },
				);
				if (receipt.stage !== "applied") throw new Error(receipt.reason ?? "The peer could not start");
			})();
			await handle.starting;
		}
		signal.throwIfAborted();
		const file = "context" in args ? contextFile(handle.id, context ? context.value : args.context) : undefined;
		const receipt = await owner.command(
			handle.id,
			{
				kind: "run_turn",
				task,
				...(outputSchema ? { outputSchema } : {}),
				...(file ? { contextFile: file } : {}),
			},
			{
				signal,
				progress(value) {
					scope.operation.activity = value.activity;
					scope.setChildren(value.children);
					scope.changed();
				},
				result(value) {
					if (value.usage) scope.addUsage(value.usage);
					scope.operation.children = value.operations;
				},
			},
		);
		const result = receipt.result;
		if (!result)
			throw new Error(
				[
					receipt.reason ?? "The peer returned no result",
					!handle.role
						? "Rehire a sleeping colleague before attaching; programs leave lasting people's lifetimes to their managers."
						: "",
				]
					.filter(Boolean)
					.join(". "),
			);
		if (result.error) {
			scope.operation.outcome = "failed";
			scope.operation.error = result.error;
		}
		const { operations, ...record } = result;
		return {
			...record,
			toolCalls: operations.length,
			...(context
				? {
						context: {
							truncated: context.truncated,
							dropped: context.dropped,
							serializedChars: context.serializedChars,
						},
					}
				: {}),
		};
	};
	const run = (key: string, args: Args, scope: RunScope): Promise<Args> => {
		const handle = get(key);
		const call = perform(handle, args, scope);
		handle.runs.add(call);
		void call.then(
			() => handle.runs.delete(call),
			() => handle.runs.delete(call),
		);
		return call;
	};
	const closePeer = async (key: string): Promise<void> => {
		const handle = get(key);
		handle.closing ??= (async () => {
			handle.controller.abort();
			await Promise.allSettled([...handle.runs]);
			if (!closing && handle.role && handle.starting && program) {
				const receipt = await (await program).command(handle.id, { kind: "discard_peer" });
				if (receipt.stage !== "applied") throw new Error(receipt.reason ?? "The peer could not be discarded");
			}
		})();
		return handle.closing;
	};
	return {
		bindings,
		create,
		run,
		closePeer,
		agent(args, scope) {
			const key = create(args.role);
			const call = (async () => {
				try {
					return await run(key, args, scope);
				} finally {
					await closePeer(key);
				}
			})();
			agents.add(call);
			void call.then(
				() => agents.delete(call),
				() => agents.delete(call),
			);
			return call;
		},
		async close() {
			closing = true;
			ending ??= (async () => {
				lifetime.abort();
				for (const handle of handles.values()) handle.controller.abort();
				try {
					if (program) await (await program).close();
				} finally {
					await Promise.allSettled([
						...agents,
						...[...handles.values()].flatMap((handle) => [...handle.runs, ...(handle.closing ? [handle.closing] : [])]),
					]);
					handles.clear();
				}
			})();
			return ending;
		},
	};
}
