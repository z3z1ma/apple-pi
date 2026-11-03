import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { TurnProgress, TurnResult } from "../../shared/src/turn-observer.js";
import { connectRuntime, RETRY_MS } from "./client.js";
import { type StatePaths, statePaths } from "./paths.js";
import { type Command, lineReader, type Receipt } from "./protocol.js";

function withDatabase<T>(paths: StatePaths, read: (db: DatabaseSync) => T): T {
	const db = new DatabaseSync(paths.db, { readOnly: true });
	try {
		return read(db);
	} finally {
		db.close();
	}
}

export interface PeerProgram {
	id: string;
	command(
		sessionId: string,
		command: Command,
		options?: {
			commandId?: string;
			signal?: AbortSignal;
			progress?: (value: TurnProgress) => void;
			result?: (value: TurnResult) => void;
		},
	): Promise<Receipt>;
	close(): Promise<void>;
}

export async function openPeerProgram(
	caller: string,
	signal?: AbortSignal,
	options: { paths?: StatePaths; id?: string } = {},
): Promise<PeerProgram> {
	const paths = options.paths ?? statePaths();
	const socket = await connectRuntime(signal, options.paths?.socket);
	socket.on("error", () => {});
	try {
		if (
			!withDatabase(paths, (db) =>
				db.prepare("select 1 from sqlite_master where type = 'table' and name = 'program_scopes'").get(),
			)
		)
			throw new Error("Restart the session-state runtime before using program peers");
	} catch (error) {
		socket.destroy();
		throw error;
	}
	const id = options.id ?? randomUUID();
	const pending = new Map<
		string,
		{ finish(receipt: Receipt): void; fail(error: unknown): void; progress?: (value: TurnProgress) => void }
	>();
	let ready!: () => void;
	let failedReady!: (error: unknown) => void;
	const opening = new Promise<void>((resolve, reject) => {
		ready = resolve;
		failedReady = reject;
	});
	let closed!: () => void;
	let failedClosed!: (error: unknown) => void;
	const closure = new Promise<void>((resolve, reject) => {
		closed = resolve;
		failedClosed = reject;
	});
	void closure.catch(() => {});
	let acknowledgedClose = false;
	let ending: Promise<void> | undefined;
	let remoteError: Error | undefined;
	let lost: Error | undefined;
	const fail = (error: unknown) => {
		failedReady(error);
		failedClosed(error);
		for (const request of pending.values()) request.fail(error);
		pending.clear();
	};
	const send = (value: unknown) => socket.write(`${JSON.stringify(value)}\n`);
	socket.on(
		"data",
		lineReader((line) => {
			try {
				const message = JSON.parse(line);
				if (message.type === "program_ready" && message.id === id) ready();
				else if (message.type === "program_closed" && message.id === id) {
					acknowledgedClose = true;
					closed();
				} else if (message.type === "program_error") {
					remoteError = new Error(message.error);
					fail(remoteError);
				} else if (message.type === "turn_progress") pending.get(message.commandId)?.progress?.(message.progress);
				else if (message.type === "receipt" && (message.stage === "applied" || message.stage === "failed"))
					pending.get(message.commandId)?.finish(message);
			} catch (error) {
				fail(error);
				socket.destroy();
			}
		}),
	);
	socket.on("error", (error) => {
		lost = error;
		fail(error);
	});
	socket.on("close", () => {
		if (acknowledgedClose) {
			for (const request of pending.values())
				request.fail(new Error("The program closed before the command completed"));
			pending.clear();
			return;
		}
		if (remoteError) return;
		lost = new Error("The runtime connection closed; the peer may have done work before the result was lost");
		fail(lost);
	});
	const abortOpening = () => {
		failedReady(signal?.reason);
		socket.destroy();
	};
	signal?.addEventListener("abort", abortOpening, { once: true });
	const close = async () => {
		if (ending) return ending;
		ending = (async () => {
			try {
				if (!socket.destroyed && !acknowledgedClose) send({ type: "program_close" });
				await closure;
			} catch (error) {
				if (remoteError || !lost) throw error;
				const connection = await connectRuntime(undefined, options.paths?.socket);
				connection.on("error", () => {});
				connection.destroy();
				for (;;) {
					const scope = withDatabase(paths, (db) =>
						db.prepare("select last_error from program_scopes where id = ?").get(id),
					) as { last_error: string | null } | undefined;
					if (!scope) break;
					if (scope.last_error) throw new Error(scope.last_error);
					await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
				}
			} finally {
				socket.destroy();
			}
		})();
		return ending;
	};
	try {
		signal?.throwIfAborted();
		send({ type: "program_open", id, caller });
		await opening;
	} catch (error) {
		socket.destroy();
		await close();
		throw error;
	} finally {
		signal?.removeEventListener("abort", abortOpening);
	}
	return {
		id,
		close,
		async command(sessionId, command, options = {}) {
			if (ending || acknowledgedClose || remoteError || lost)
				throw remoteError ?? lost ?? new Error("The program is closed");
			options.signal?.throwIfAborted();
			const commandId = options.commandId ?? randomUUID();
			if (pending.has(commandId)) throw new Error("This command is already waiting for a result");
			return new Promise<Receipt>((resolve, reject) => {
				const finish = (receipt?: Receipt, error?: unknown) => {
					options.signal?.removeEventListener("abort", abort);
					pending.delete(commandId);
					if (receipt?.result) options.result?.(receipt.result);
					if (error !== undefined) reject(error);
					else if (options.signal?.aborted) reject(options.signal.reason);
					else resolve(receipt!);
				};
				const abort = () => {
					if (socket.destroyed) return;
					const cancel: Command =
						command.kind === "run_turn" ? { kind: "cancel_turn", turn: commandId } : { kind: "discard_peer" };
					if (command.kind === "run_turn" || command.kind === "start")
						send({ type: "command", commandId: randomUUID(), sessionId, command: cancel });
				};
				pending.set(commandId, {
					finish: (receipt) => finish(receipt),
					fail: (error) => finish(undefined, error),
					progress: options.progress,
				});
				options.signal?.addEventListener("abort", abort, { once: true });
				send({ type: "command", commandId, sessionId, command });
			});
		},
	};
}
