import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
	CollectString,
	Monty,
	MontyCrashedError,
	MontyRuntimeError,
	type MontySession,
	MontyTypingError,
	ProtocolError,
} from "@pydantic/monty";
import { PROGRAM_ENVELOPE_MAXIMA } from "./envelope.js";
import { CORE_TOOL_NAMES } from "./core-tools.js";
import { extensionPythonTools } from "./guest-api.js";
import { EVIDENCE_FUNCTION_NAMES } from "./evidence.js";
import { PYTHON_SCHEMA_PRELUDE } from "./python-schema.js";
import type { ProgramExecution, ProgramHostCall } from "./types.js";

function jsonValue(value: unknown, seen = new Set<object>(), hostArguments = false): unknown {
	if (
		!hostArguments &&
		typeof value === "string" &&
		(/^<function .+ at 0x[0-9a-f]+>$/.test(value) || ["[...]", "{...}", "(...)"].includes(value))
	)
		throw new Error("pi_exec result is not JSON-serializable");
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) return value;
	if (typeof value !== "object" || !value) throw new Error("pi_exec result is not JSON-serializable");
	if (seen.has(value)) throw new Error("pi_exec result contains a cycle");
	seen.add(value);
	try {
		if (Array.isArray(value)) return value.map((item) => jsonValue(item, seen, hostArguments));
		if (
			value instanceof Map ||
			(hostArguments && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null))
		) {
			const result: Record<string, unknown> = Object.create(null);
			for (const [key, item] of value instanceof Map ? value : Object.entries(value)) {
				if (typeof key !== "string") throw new Error("pi_exec result has a non-string dictionary key");
				result[key] = jsonValue(item, seen, hostArguments);
			}
			return result;
		}
		throw new Error("pi_exec result is not JSON-serializable");
	} finally {
		seen.delete(value);
	}
}

function keyboardInterrupt(): Error {
	const error = new Error("pi_exec aborted");
	error.name = "KeyboardInterrupt";
	return error;
}

export async function createProgramSession(
	stubs: string,
	dump?: Uint8Array,
): Promise<{ session: MontySession; close(): Promise<void> }> {
	const pool = await Monty.create({ minProcesses: 0, maxProcesses: 1 });
	let session: MontySession | undefined;
	try {
		session = await pool.checkout({
			limits: {
				maxMemory: PROGRAM_ENVELOPE_MAXIMA.memoryMb * 1024 * 1024,
				maxTurnDurationSecs: PROGRAM_ENVELOPE_MAXIMA.timeoutSeconds,
				maxFeedDurationSecs: PROGRAM_ENVELOPE_MAXIMA.timeoutSeconds,
				maxSuspensions: (PROGRAM_ENVELOPE_MAXIMA.callBudget + 1) * 2,
			},
			typeCheck: true,
			typeCheckStubs: stubs,
		});
		if (dump) await session.loadSession(dump);
		else await session.feedRun(PYTHON_SCHEMA_PRELUDE);
		const live = session;
		return {
			session: live,
			async close() {
				try {
					await live.close();
				} finally {
					await pool.close();
				}
			},
		};
	} catch (error) {
		try {
			await session?.close();
		} finally {
			await pool.close();
		}
		throw error;
	}
}

/** Run one Python feed against the root session's live Monty interpreter. */
export async function executeProgram(
	session: MontySession,
	code: string,
	inputs: Record<string, string>,
	timeoutMs: number,
	hostCall: ProgramHostCall,
	signal?: AbortSignal,
	onLog?: (values: unknown[]) => void,
	onInterrupt?: () => void,
): Promise<ProgramExecution> {
	if (signal?.aborted) return { outcome: "aborted", error: "pi_exec aborted", sessionUsable: false };
	const controller = new AbortController();
	const pending = new Set<(reason: Error) => void>();
	let timedOut = false;
	let feedSettled = true;
	let rejectStopped: (reason: Error) => void = () => {};
	const stopped = new Promise<never>((_resolve, reject) => {
		rejectStopped = reject;
	});
	const stop = () => {
		if (controller.signal.aborted) return;
		controller.abort();
		if (!feedSettled) onInterrupt?.();
		for (const reject of pending) reject(keyboardInterrupt());
		rejectStopped(keyboardInterrupt());
	};
	const timer = setTimeout(() => {
		timedOut = true;
		stop();
	}, timeoutMs);
	timer.unref?.();
	signal?.addEventListener("abort", stop, { once: true });
	if (signal?.aborted) stop();
	const collector = new (class extends CollectString {
		override write(stream: "stdout" | "stderr", text: string) {
			try {
				super.write(stream, text);
			} catch (error) {
				if (error instanceof MontyRuntimeError && error.exception.typeName === "MemoryError")
					throw new MontyRuntimeError("MemoryError", `Captured print output limit exceeded (10 MiB): ${error.message}`);
				throw error;
			}
		}
	})();
	const invoke = (ref: string, args: Record<string, unknown> = {}) => {
		const converted = jsonValue(args, new Set(), true) as Record<string, unknown>;
		return new Promise<unknown>((resolve, reject) => {
			if (controller.signal.aborted) return reject(keyboardInterrupt());
			pending.add(reject);
			void hostCall(ref, converted, controller.signal)
				.then((value) => resolve(value === undefined ? null : value), reject)
				.finally(() => pending.delete(reject));
		});
	};
	const agentRun = async (args: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
		const { system_prompt, output_schema, ...rest } = args;
		try {
			return (await invoke("agent.run", {
				...rest,
				...(system_prompt !== undefined ? { systemPrompt: system_prompt } : {}),
				...(output_schema !== undefined ? { outputSchema: output_schema } : {}),
			})) as Record<string, unknown>;
		} catch (error) {
			if (controller.signal.aborted) throw keyboardInterrupt();
			return {
				status: "failed",
				error: error instanceof Error ? error.message : String(error),
				text: "",
				toolCalls: 0,
			};
		}
	};
	const fetchResource = async (input: string | Record<string, unknown>, kwargs: Record<string, unknown> = {}) => {
		const options = typeof input === "string" ? kwargs : input;
		const url = typeof input === "string" ? input : input.url;
		const { method, headers, body } = options;
		const pairs =
			headers === undefined ? undefined : Object.entries(jsonValue(headers, new Set(), true) as Record<string, string>);
		const encodedBody =
			body === undefined ? undefined : Buffer.from(body instanceof Uint8Array ? body : String(body)).toString("base64");
		const response = (await invoke("fetch", {
			url,
			...(method !== undefined ? { method } : {}),
			...(pairs !== undefined ? { headers: pairs } : {}),
			...(encodedBody !== undefined ? { body: encodedBody } : {}),
		})) as Record<string, unknown>;
		const bytes = Buffer.from(String(response.body ?? ""), "base64");
		const headersMap = Object.fromEntries(response.headers as Array<[string, string]>);
		const contentType = String(headersMap["content-type"] ?? "");
		const text = /^text\/|json|xml|javascript/i.test(contentType);
		return {
			status: response.status,
			headers: headersMap,
			url: response.url,
			body: text ? bytes.toString("utf8") : bytes,
			...(text ? { text: bytes.toString("utf8") } : {}),
		};
	};
	const named = (value: unknown, key: string) =>
		value && typeof value === "object" && !(value instanceof Map) ? (value as Record<string, unknown>)[key] : value;
	const externalLookup = {
		fetch: fetchResource,
		tools_list: () => invoke("tools.list"),
		tools_search: (query: unknown) => invoke("tools.search", { query: named(query, "query") }),
		tools_describe: (name: unknown) => invoke("tools.describe", { name: named(name, "name") }),
		tools_call: (name: unknown, args: Record<string, unknown> = {}) => {
			if (name && typeof name === "object" && !(name instanceof Map)) {
				const params = name as Record<string, unknown>;
				return invoke("tools.call", { name: params.name, args: params.args ?? {} });
			}
			return invoke("tools.call", { name, args });
		},
		skills_list: () => invoke("skills.list"),
		skills_body: (name: unknown) => invoke("skills.body", { name: named(name, "name") }),
		agent_run: agentRun,
		agent: async (args: Record<string, unknown> = {}) => {
			const result = await agentRun(args);
			if (result.status !== "completed") throw new Error(String(result.error ?? "Agent failed"));
			return result.value === undefined ? result.text : result.value;
		},
		...Object.fromEntries(
			CORE_TOOL_NAMES.map((name) => [name, (args: Record<string, unknown> = {}) => invoke(`pi.${name}`, args)]),
		),
		...Object.fromEntries(
			EVIDENCE_FUNCTION_NAMES.map((name) => [
				name,
				(args: Record<string, unknown> = {}) => invoke(`evidence.${name}`, args),
			]),
		),
		...Object.fromEntries(
			extensionPythonTools().map((tool) => [
				tool.name,
				(args: Record<string, unknown> = {}) => invoke("tools.call", { name: tool.name, args }),
			]),
		),
	};
	try {
		if (controller.signal.aborted) throw keyboardInterrupt();
		const feed = session.feedRun(code, { inputs: { inputs }, externalLookup, printCallback: collector });
		feedSettled = false;
		void feed.then(
			() => {
				feedSettled = true;
			},
			() => {
				feedSettled = true;
			},
		);
		const result = await Promise.race([feed, stopped]);
		if (timedOut)
			return { outcome: "timed_out", error: `pi_exec timed out after ${timeoutMs}ms`, sessionUsable: false };
		if (controller.signal.aborted) return { outcome: "aborted", error: "pi_exec aborted", sessionUsable: false };
		return { outcome: "succeeded", value: jsonValue(result), sessionUsable: true };
	} catch (error) {
		if (timedOut)
			return { outcome: "timed_out", error: `pi_exec timed out after ${timeoutMs}ms`, sessionUsable: false };
		if (controller.signal.aborted || signal?.aborted)
			return { outcome: "aborted", error: "pi_exec aborted", sessionUsable: false };
		if (error instanceof MontyRuntimeError && error.exception.typeName === "TimeoutError")
			return {
				outcome: "timed_out",
				error: `pi_exec timed out after ${timeoutMs}ms: ${error.display()}`,
				sessionUsable: false,
			};
		if (error instanceof MontyCrashedError && error.timedOut)
			return { outcome: "timed_out", error: error.message, sessionUsable: false };
		const terminal =
			error instanceof MontyCrashedError ||
			error instanceof ProtocolError ||
			(error instanceof MontyRuntimeError &&
				(error.exception.typeName === "MemoryError" || /suspension limit/i.test(error.message)));
		return {
			outcome: "failed",
			error:
				error instanceof MontyTypingError ? error.display() : error instanceof Error ? error.message : String(error),
			sessionUsable: !terminal,
		};
	} finally {
		stop();
		clearTimeout(timer);
		signal?.removeEventListener("abort", stop);
		const output = collector.output;
		if (output) onLog?.([output.trimEnd()]);
	}
}

export function isOwnedMontyWorker(pid: number | undefined): boolean {
	if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
	if (process.platform === "win32") {
		try {
			const tasklist = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tasklist.exe");
			const output = execFileSync(tasklist, ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 1_000,
			}).trim();
			return output.toLowerCase().includes("monty.exe");
		} catch {
			return false;
		}
	}
	try {
		const output = execFileSync("ps", ["-p", String(pid), "-o", "ppid=,command="], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 1_000,
		}).trim();
		const [ppidStr, ...rest] = output.split(/\s+/);
		const ppid = Number(ppidStr);
		const command = rest.join(" ");
		return ppid === process.pid && command.includes("monty") && command.includes("subprocess");
	} catch {
		return false;
	}
}
