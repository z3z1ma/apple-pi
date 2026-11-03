import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { getPackageDir } from "@earendil-works/pi-coding-agent";
import { statePaths } from "./paths.js";
import { type Command, lineReader, type Receipt } from "./protocol.js";

const RUNTIME_MAIN = fileURLToPath(new URL("./runtime-main.runtime.ts", import.meta.url));
const REGISTER = new URL("./register.mjs", import.meta.url).href;
export const RETRY_MS = 250;

export function hostPackageEnv(): NodeJS.ProcessEnv {
	return { ...process.env, PI_HOST_PACKAGE_DIR: process.env.PI_HOST_PACKAGE_DIR ?? getPackageDir() };
}

export function spawnRuntime(warn: (message: string) => void): ChildProcess | undefined {
	const paths = statePaths();
	let log: number;
	try {
		mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
		log = openSync(paths.log, "a", 0o600);
	} catch (error) {
		warn(`Session state: cannot use ${paths.dir}: ${(error as Error).message}`);
		return undefined;
	}
	const child = spawn(process.execPath, ["--import", REGISTER, RUNTIME_MAIN], {
		detached: true,
		stdio: ["ignore", log, log],
		env: hostPackageEnv(),
	});
	closeSync(log);
	child.on("error", (error) => warn(`Session state: cannot start the runtime: ${error.message}`));
	child.on("exit", (code) => {
		if (code) warn(`Session state: the runtime exited with code ${code}; see ${paths.log}`);
	});
	child.unref();
	return child;
}

function open(path: string, signal?: AbortSignal): Promise<Socket> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(path);
		const abort = () => {
			socket.destroy();
			reject(signal?.reason);
		};
		signal?.addEventListener("abort", abort, { once: true });
		socket.once("connect", () => {
			signal?.removeEventListener("abort", abort);
			socket.off("error", reject);
			resolve(socket);
		});
		socket.once("error", (error) => {
			signal?.removeEventListener("abort", abort);
			reject(error);
		});
	});
}

export async function connectRuntime(signal?: AbortSignal, socketPath?: string): Promise<Socket> {
	if (socketPath !== undefined) return open(socketPath, signal);
	let started = false;
	let failure: string | undefined;
	for (;;) {
		signal?.throwIfAborted();
		try {
			return await open(statePaths().socket, signal);
		} catch {
			signal?.throwIfAborted();
			if (failure) throw new Error(failure);
			if (!started) {
				started = true;
				spawnRuntime((message) => {
					failure = message;
				});
			}
			await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
		}
	}
}

export async function sendCommand(
	sessionId: string,
	command: Command,
	options: { commandId?: string; signal?: AbortSignal; until?: "accepted" | "applied"; socketPath?: string } = {},
): Promise<Receipt> {
	const commandId = options.commandId ?? randomUUID();
	options.signal?.throwIfAborted();
	const socket = await connectRuntime(options.signal, options.socketPath);
	const { signal } = options;
	let abort = () => {};
	try {
		signal?.throwIfAborted();
		return await new Promise<Receipt>((resolve, reject) => {
			abort = () => reject(signal?.reason);
			signal?.addEventListener("abort", abort, { once: true });
			socket.on(
				"data",
				lineReader((line) => {
					const receipt = JSON.parse(line) as Receipt;
					if (receipt.type !== "receipt" || receipt.commandId !== commandId) return;
					if (options.until === "accepted" || receipt.stage === "applied" || receipt.stage === "failed")
						resolve(receipt);
				}),
			);
			socket.on("close", () => reject(new Error("the session-state runtime closed the connection")));
			socket.on("error", reject);
			socket.write(`${JSON.stringify({ type: "command", commandId, sessionId, command })}\n`);
		});
	} finally {
		signal?.removeEventListener("abort", abort);
		socket.destroy();
	}
}
