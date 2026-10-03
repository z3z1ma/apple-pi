import { createHash } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sealCheckpoint, verifyCheckpoint } from "./checkpoint.js";
import { PROGRAM_ENVELOPE_MAXIMA } from "./envelope.js";
import { guestPythonStubs } from "./guest-api.js";
import { createProgramSession, executeProgram, isOwnedMontyWorker } from "./program.js";
import type { ProgramExecution, ProgramHostCall } from "./types.js";

const MONTY_ENTRY_TYPE = "apple-pi:monty-session";
const ROLLBACK_NOTICE =
	"Monty state was rolled back to the last saved checkpoint. Completed tool, file, and process effects were not undone.";

type LiveSession = Awaited<ReturnType<typeof createProgramSession>>;
type BranchCheckpoint = { found: boolean; data?: unknown };

export interface ProgramRunRequest {
	code: string;
	inputs: Record<string, string>;
	timeoutMs: number;
	callBudget: number;
	/** Start from empty Python state and checkpoint it before running. */
	reset: boolean;
	hostCall: ProgramHostCall;
	signal: AbortSignal | undefined;
	onLog: (values: unknown[]) => void;
}

export interface ProgramRun {
	execution: ProgramExecution;
	/** Why restored Python state was unavailable, reported once on the next run. */
	notice?: string;
}

function branchCheckpoint(ctx: ExtensionContext): BranchCheckpoint {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index]!;
		if (entry.type === "custom" && entry.customType === MONTY_ENTRY_TYPE) return { found: true, data: entry.data };
	}
	return { found: false };
}

function stopWorker(live: LiveSession, pid: number | undefined): void {
	if (pid === undefined || live.session.workerPid !== undefined) return;
	if (!isOwnedMontyWorker(pid)) return;
	try {
		process.kill(pid, "SIGKILL");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") console.error("pi_exec could not stop Monty worker", error);
	}
}

async function close(live: LiveSession): Promise<void> {
	await live.close().catch((error) => console.error("pi_exec Monty cleanup failed", error));
}

/**
 * Own one Monty interpreter for the current Pi session branch. Python globals persist across runs and are
 * checkpointed into the branch after every usable run. Switching branches discards the interpreter; the next run
 * restores that branch's latest checkpoint. An unusable run rolls back to the last checkpoint.
 */
export function installProgramSession(pi: ExtensionAPI): {
	run(ctx: ExtensionContext, request: ProgramRunRequest): Promise<ProgramRun>;
} {
	let owner: LiveSession | undefined;
	let ownerHash: string | undefined;
	let hostCalls = 0;
	let selected: BranchCheckpoint | undefined;
	let notice: string | undefined;
	// Incremented whenever the owner is discarded, so in-flight work can detect that its session went away.
	let generation = 0;
	let activeAbort: AbortController | undefined;

	const discard = async () => {
		generation++;
		activeAbort?.abort();
		const previous = owner;
		owner = undefined;
		ownerHash = undefined;
		hostCalls = 0;
		if (previous) await close(previous);
	};
	const abandon = async (live: LiveSession) => {
		if (owner !== live) return;
		owner = undefined;
		ownerHash = undefined;
		hostCalls = 0;
		await close(live);
	};
	const selectBranch = async (ctx: ExtensionContext) => {
		await discard();
		selected = branchCheckpoint(ctx);
		notice = undefined;
	};
	pi.on("session_start", (_event, ctx) => selectBranch(ctx));
	pi.on("session_tree", (_event, ctx) => selectBranch(ctx));
	pi.on("session_shutdown", async () => {
		await discard();
		selected = undefined;
	});

	const checkout = async (ctx: ExtensionContext): Promise<LiveSession> => {
		if (owner) return owner;
		const stubs = guestPythonStubs(ctx.cwd);
		const hash = createHash("sha256").update(stubs).digest("hex");
		const checkpoint = selected ?? branchCheckpoint(ctx);
		selected = undefined;
		if (checkpoint.found) {
			const dump = await verifyCheckpoint(ctx.sessionManager, checkpoint.data, hash);
			if (dump) {
				try {
					owner = await createProgramSession(stubs, dump);
					ownerHash = hash;
					return owner;
				} catch (error) {
					notice = `Monty checkpoint could not be loaded; started an empty session: ${error instanceof Error ? error.message : String(error)}`;
				}
			} else {
				notice = "Monty checkpoint is incompatible or unverifiable; started an empty session.";
			}
		}
		owner = await createProgramSession(stubs);
		ownerHash = hash;
		return owner;
	};
	const commit = async (ctx: ExtensionContext, live: LiveSession, expectedGeneration: number) => {
		const dump = await live.session.dump();
		const checkpoint = await sealCheckpoint(ctx.sessionManager, dump, ownerHash!);
		if (generation !== expectedGeneration || owner !== live)
			throw new Error("pi_exec session changed during checkpoint");
		pi.appendEntry(MONTY_ENTRY_TYPE, checkpoint);
	};

	return {
		async run(ctx, request) {
			if (request.reset) {
				await discard();
				selected = { found: false };
				notice = undefined;
			}
			// Monty counts suspensions across a checkout; rebase from the last checkpoint before the next run could exhaust it.
			if (owner && hostCalls + request.callBudget > PROGRAM_ENVELOPE_MAXIMA.callBudget) {
				await discard();
				selected = branchCheckpoint(ctx);
			}
			const runGeneration = generation;
			const live = await checkout(ctx);
			if (runGeneration !== generation) {
				await abandon(live);
				throw new Error("pi_exec session changed during checkout");
			}
			if (request.reset) {
				try {
					await commit(ctx, live, runGeneration);
				} catch (error) {
					await abandon(live);
					throw error;
				}
			}
			const runNotice = notice;
			notice = undefined;
			activeAbort = new AbortController();
			try {
				const workerPid = live.session.workerPid;
				const signal = request.signal ? AbortSignal.any([request.signal, activeAbort.signal]) : activeAbort.signal;
				let calls = 0;
				let execution = await executeProgram(
					live.session,
					request.code,
					request.inputs,
					request.timeoutMs,
					(ref, args, callSignal) => {
						calls++;
						return request.hostCall(ref, args, callSignal);
					},
					signal,
					request.onLog,
					() => stopWorker(live, workerPid),
				);
				hostCalls += calls;
				if (execution.sessionUsable && runGeneration === generation && owner === live) {
					try {
						await commit(ctx, live, runGeneration);
					} catch (error) {
						execution = {
							outcome: "failed",
							error: `pi_exec could not save Monty state: ${error instanceof Error ? error.message : String(error)}`,
							sessionUsable: false,
						};
					}
				}
				if (!execution.sessionUsable || runGeneration !== generation) {
					await abandon(live);
					execution = {
						...execution,
						outcome: execution.outcome === "succeeded" ? "aborted" : execution.outcome,
						error: `${execution.error ?? "pi_exec session changed"} ${ROLLBACK_NOTICE}`,
						sessionUsable: false,
					};
				}
				return { execution, ...(runNotice ? { notice: runNotice } : {}) };
			} finally {
				activeAbort = undefined;
			}
		},
	};
}
