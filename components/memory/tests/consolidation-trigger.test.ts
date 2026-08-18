import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAgents = vi.hoisted(() => ({
	runCurator: vi.fn(),
}));

vi.mock("../src/agents/curator/agent.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/agents/curator/agent.js")>()),
	runCurator: mockAgents.runCurator,
}));

import { CONSOLIDATION_ABORT_REASON, errorFromAbortSignal, isQuietConsolidationAbort } from "../src/abort.js";
import { CuratorStreamError } from "../src/agents/curator/agent.js";
import { registerConsolidationTrigger } from "../src/hooks/consolidation-trigger.js";
import { isStaleExtensionCtxError } from "../src/runtime.js";
import {
	OM_OBSERVATIONS_DROPPED,
	OM_OBSERVATIONS_RECORDED,
	OM_REFLECTIONS_RECORDED,
	OM_REFLECTIONS_RETIRED,
} from "../src/session-ledger/index.js";
import {
	observation,
	observationsRecordedEntry,
	reflection,
	reflectionsRecordedEntry,
	type TestEntry,
	textCustomMessage,
} from "./fixtures/session.js";

beforeEach(() => {
	mockAgents.runCurator.mockReset();
	mockAgents.runCurator.mockResolvedValue(undefined);
});

function setup(args: {
	entries: TestEntry[];
	observeAfterTokens?: number;
	reflectAfterTokens?: number;
	observerChunkMaxTokens?: number;
	observationsPoolMaxTokens?: number;
	observationsPoolTargetTokens?: number;
	showWorkerNotifications?: boolean;
	passive?: boolean;
	consolidationInFlight?: boolean;
	sessionId?: string;
}) {
	let entries = [...args.entries];
	let sessionId = args.sessionId ?? "session-1";
	const handlers: Record<string, ((event: unknown, ctx: any) => void) | undefined> = {};
	const pi = {
		on: vi.fn((eventName: string, cb: (event: unknown, ctx: any) => void) => {
			handlers[eventName] = cb;
		}),
		appendEntry: vi.fn((customType: string, data: unknown) => {
			const id = `appended-${pi.appendEntry.mock.calls.length}`;
			entries = [
				...entries,
				{
					type: "custom",
					id,
					parentId: entries.at(-1)?.id ?? null,
					timestamp: "2026-05-02T10:00:00.000Z",
					customType,
					data,
				},
			];
			return id;
		}),
	};
	let launchedWork: (() => Promise<void>) | undefined;
	const runtime = {
		config: {
			showWorkerNotifications: args.showWorkerNotifications ?? true,
			passive: args.passive ?? false,
			debugLog: false,
			observeAfterTokens: args.observeAfterTokens ?? 1,
			reflectAfterTokens: args.reflectAfterTokens ?? 1,
			observerChunkMaxTokens: args.observerChunkMaxTokens,
			observationsPoolMaxTokens: args.observationsPoolMaxTokens ?? 100,
			observationsPoolTargetTokens:
				args.observationsPoolTargetTokens ?? Math.floor((args.observationsPoolMaxTokens ?? 100) / 2),
			agentMaxTurns: 9,
		},
		disposed: false,
		dispose: vi.fn(() => {
			runtime.disposed = true;
		}),
		abortConsolidation: vi.fn(),
		consolidationSignal: undefined as AbortSignal | undefined,
		consolidationInFlight: args.consolidationInFlight ?? false,
		consolidationPhase: undefined as "curator" | undefined,
		resolveFailureNotified: false,
		lastCuratorError: undefined as string | undefined,
		observerEmptyBackoff: undefined as
			| { sessionIdentity: string | undefined; coverageId: string | undefined; tokensAtEmpty: number }
			| undefined,
		ensureConfig: vi.fn(() => runtime.config),
		resolveModel: vi.fn(async () => ({
			ok: true,
			model: { reasoning: true },
			apiKey: "key",
			headers: { h: "v" },
			thinkingLevel: "minimal",
		})),
		launchConsolidationTask: vi.fn((_ctx, work) => {
			runtime.consolidationInFlight = true;
			launchedWork = work;
			return Promise.resolve();
		}),
		recordConsolidationStageError: vi.fn((ctx, phase: "curator", error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			if (isStaleExtensionCtxError(error) || isQuietConsolidationAbort(error)) return message;
			runtime.lastCuratorError = message;
			ctx.ui?.notify(`Observational memory: ${phase} failed: ${message}`, "warning");
			return message;
		}),
	};
	registerConsolidationTrigger(pi as any, runtime as any);
	if (!handlers.turn_end) throw new Error("turn_end consolidation handler not registered");
	if (!handlers.agent_start) throw new Error("agent_start abort handler not registered");
	const ctx = {
		cwd: "/tmp/project",
		hasUI: true,
		ui: { notify: vi.fn() },
		model: { provider: "session" },
		modelRegistry: {},
		sessionManager: {
			getBranch: () => entries,
			getSessionId: () => sessionId,
		},
	};
	return {
		pi,
		runtime,
		ctx,
		fire: (eventName = "turn_end") => handlers[eventName]!(undefined, ctx),
		fireAgentStart: () => handlers.agent_start!(undefined, ctx),
		fireTurnEnd: () => handlers.turn_end!(undefined, ctx),
		fireSessionShutdown: () => handlers.session_shutdown!(undefined, ctx),
		runLaunchedWork: async () => launchedWork?.(),
		setSessionId: (next: string) => {
			sessionId = next;
		},
	};
}

describe("V3 consolidation trigger", () => {
	const obsA = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"], tokenCount: 10 });
	const refA = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"]);

	it("registers turn_end launch, agent_start abort, and session_shutdown", () => {
		const { pi } = setup({ entries: [textCustomMessage("raw-1", "aaaaaaaa")] });
		expect(pi.on).toHaveBeenCalledWith("turn_end", expect.any(Function));
		expect(pi.on).toHaveBeenCalledWith("agent_start", expect.any(Function));
		expect(pi.on).toHaveBeenCalledWith("session_shutdown", expect.any(Function));
	});

	it("does not launch below the observe threshold", () => {
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
		];
		const { fireTurnEnd, runtime } = setup({ entries, observeAfterTokens: 10 });
		fireTurnEnd();
		expect(runtime.launchConsolidationTask).not.toHaveBeenCalled();
	});

	it("does not launch for reflection or pool overflow without an observe-due chunk", () => {
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref", { reflections: [refA], coversUpToId: "raw-1" }),
		];
		const { fireTurnEnd, runtime } = setup({
			entries,
			observeAfterTokens: 999,
			reflectAfterTokens: 1,
			observationsPoolTargetTokens: 5,
		});
		fireTurnEnd();
		expect(runtime.launchConsolidationTask).not.toHaveBeenCalled();
	});

	it("does not launch in passive mode", () => {
		const { fireTurnEnd, runtime } = setup({ entries: [textCustomMessage("raw-1", "aaaaaaaa")], passive: true });
		fireTurnEnd();
		expect(runtime.launchConsolidationTask).not.toHaveBeenCalled();
	});

	it("does not launch while consolidation is already in flight", () => {
		const { fireTurnEnd, runtime } = setup({
			entries: [textCustomMessage("raw-1", "aaaaaaaa")],
			consolidationInFlight: true,
		});
		fireTurnEnd();
		expect(runtime.launchConsolidationTask).not.toHaveBeenCalled();
	});

	it("does not launch from agent_start", () => {
		const { fireAgentStart, runtime } = setup({ entries: [textCustomMessage("raw-1", "aaaaaaaa")] });
		fireAgentStart();
		expect(runtime.launchConsolidationTask).not.toHaveBeenCalled();
		expect(runtime.abortConsolidation).toHaveBeenCalledWith(CONSOLIDATION_ABORT_REASON.userTurn);
	});

	it("launches from turn_end when observation work is due", () => {
		const { fireTurnEnd, runtime } = setup({ entries: [textCustomMessage("raw-1", "aaaaaaaa")] });
		fireTurnEnd();
		expect(runtime.launchConsolidationTask).toHaveBeenCalledTimes(1);
	});

	it("aborts an in-flight run when a new user turn starts", () => {
		const { fireAgentStart, fireTurnEnd, runtime } = setup({ entries: [textCustomMessage("raw-1", "aaaaaaaa")] });
		fireTurnEnd();
		fireAgentStart();
		expect(runtime.launchConsolidationTask).toHaveBeenCalledTimes(1);
		expect(runtime.abortConsolidation).toHaveBeenCalledWith(CONSOLIDATION_ABORT_REASON.userTurn);
	});

	it("appends curator records in observe/reflect/retire/drop order", async () => {
		const obs = observation("cccccccccccc", { sourceEntryIds: ["raw-1"], tokenCount: 4 });
		const newRef = reflection("ffffffffffff", [obs.id]);
		mockAgents.runCurator.mockResolvedValueOnce({
			observations: [obs],
			reflections: [newRef],
			retiredIds: ["eeeeeeeeeeee"],
			droppedIds: [obs.id],
		});
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-prior", { observations: [obsA], coversUpToId: "raw-0" }),
			reflectionsRecordedEntry("om-ref", { reflections: [refA], coversUpToId: "raw-0" }),
		];
		const { fire, runLaunchedWork, pi, runtime } = setup({ entries });

		fire();
		await runLaunchedWork();

		expect(mockAgents.runCurator).toHaveBeenCalledWith(
			expect.objectContaining({
				allowedSourceEntryIds: ["raw-1"],
				maxTurns: 9,
				thinkingLevel: "minimal",
				targetTokens: runtime.config.observationsPoolTargetTokens,
			}),
		);
		expect(pi.appendEntry.mock.calls.map((call: unknown[]) => call[0])).toEqual([
			OM_OBSERVATIONS_RECORDED,
			OM_REFLECTIONS_RECORDED,
			OM_REFLECTIONS_RETIRED,
			OM_OBSERVATIONS_DROPPED,
		]);
		expect(pi.appendEntry.mock.calls[0][1]).toEqual({ observations: [obs], coversUpToId: "raw-1" });
		expect(pi.appendEntry.mock.calls[1][1]).toEqual({ reflections: [newRef], coversUpToId: "raw-1" });
		expect(pi.appendEntry.mock.calls[2][1]).toEqual({
			reflectionIds: ["eeeeeeeeeeee"],
			coversUpToId: "raw-1",
			successorIds: [newRef.id],
		});
		expect(pi.appendEntry.mock.calls[3][1]).toEqual({ observationIds: [obs.id], coversUpToId: "raw-1" });
	});

	it("forwards OAuth-shaped auth to the curator", async () => {
		const obs = observation("cccccccccccc", { sourceEntryIds: ["raw-1"], tokenCount: 4 });
		mockAgents.runCurator.mockResolvedValueOnce({
			observations: [obs],
			reflections: [],
			retiredIds: [],
			droppedIds: [],
		});
		const { fire, runLaunchedWork, runtime } = setup({ entries: [textCustomMessage("raw-1", "aaaaaaaa")] });
		runtime.resolveModel.mockResolvedValue({
			ok: true,
			model: { reasoning: true },
			headers: { Authorization: "Bearer token" },
			thinkingLevel: "minimal",
		});

		fire();
		await runLaunchedWork();

		expect(mockAgents.runCurator).toHaveBeenCalledWith(
			expect.objectContaining({ apiKey: undefined, headers: { Authorization: "Bearer token" } }),
		);
	});

	it("writes nothing and arms empty backoff when the curator accepts nothing", async () => {
		const { fire, runLaunchedWork, pi, runtime, ctx } = setup({ entries: [textCustomMessage("raw-1", "aaaaaaaa")] });
		fire();
		await runLaunchedWork();

		expect(pi.appendEntry).not.toHaveBeenCalled();
		expect(runtime.observerEmptyBackoff).toMatchObject({ tokensAtEmpty: expect.any(Number) });
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("nothing to record"), "info");
		expect(ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("failed"), "warning");
	});

	it("backs off empty re-fires until enough new tokens arrive", async () => {
		const { fire, runLaunchedWork, runtime } = setup({
			entries: [textCustomMessage("raw-1", "aaaaaaaa")],
		});
		fire();
		await runLaunchedWork();
		expect(mockAgents.runCurator).toHaveBeenCalledTimes(1);

		runtime.consolidationInFlight = false;
		fire();
		expect(mockAgents.runCurator).toHaveBeenCalledTimes(1);
	});

	it("does not apply empty backoff to another session", async () => {
		const harness = setup({ entries: [textCustomMessage("raw-1", "aaaaaaaa")] });
		harness.fire();
		await harness.runLaunchedWork();
		harness.runtime.consolidationInFlight = false;
		harness.setSessionId("session-2");
		harness.fire();
		await harness.runLaunchedWork();
		expect(mockAgents.runCurator).toHaveBeenCalledTimes(2);
	});

	it("surfaces curator stream errors as failure, never as empty", async () => {
		mockAgents.runCurator.mockRejectedValueOnce(new CuratorStreamError("error", "prompt is too long"));
		const { fire, runLaunchedWork, pi, runtime, ctx } = setup({ entries: [textCustomMessage("raw-1", "aaaaaaaa")] });
		fire();
		await runLaunchedWork();
		expect(pi.appendEntry).not.toHaveBeenCalled();
		expect(runtime.lastCuratorError).toContain("prompt is too long");
		expect(runtime.observerEmptyBackoff).toBeUndefined();
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("curator failed"), "warning");
	});

	it("silently aborts on signal-initiated CuratorStreamError", async () => {
		mockAgents.runCurator.mockRejectedValueOnce(new CuratorStreamError("aborted"));
		const { fire, runLaunchedWork, pi, runtime, ctx } = setup({ entries: [textCustomMessage("raw-1", "aaaaaaaa")] });
		runtime.consolidationSignal = AbortSignal.abort(CONSOLIDATION_ABORT_REASON.userTurn);
		fire();
		await runLaunchedWork();
		expect(pi.appendEntry).not.toHaveBeenCalled();
		expect(runtime.lastCuratorError).toBeUndefined();
		expect(ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("failed"), "warning");
	});

	it("surfaces independent API aborts when the signal is not aborted", async () => {
		mockAgents.runCurator.mockRejectedValueOnce(new CuratorStreamError("aborted", "provider cancelled"));
		const { fire, runLaunchedWork, runtime, ctx } = setup({ entries: [textCustomMessage("raw-1", "aaaaaaaa")] });
		fire();
		await runLaunchedWork();
		expect(runtime.lastCuratorError).toContain("aborted");
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("curator failed"), "warning");
	});

	it("stays quiet when runCurator rejects with a user-turn AbortError", async () => {
		const abortError = errorFromAbortSignal(AbortSignal.abort(CONSOLIDATION_ABORT_REASON.userTurn));
		mockAgents.runCurator.mockRejectedValueOnce(abortError);
		const { fire, runLaunchedWork, pi, runtime, ctx } = setup({ entries: [textCustomMessage("raw-1", "aaaaaaaa")] });
		fire();
		await runLaunchedWork();
		expect(pi.appendEntry).not.toHaveBeenCalled();
		expect(runtime.lastCuratorError).toBeUndefined();
		expect(ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("failed"), "warning");
	});

	it("model resolution failure skips appending and notifies once", async () => {
		const { fire, runLaunchedWork, pi, runtime, ctx } = setup({ entries: [textCustomMessage("raw-1", "aaaaaaaa")] });
		runtime.resolveModel.mockResolvedValue({ ok: false, reason: "no API key" });
		fire();
		await runLaunchedWork();
		expect(mockAgents.runCurator).not.toHaveBeenCalled();
		expect(pi.appendEntry).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("curator skipped"), "warning");
	});

	it("writes reflections and drops against existing observation coverage when the pass records none", async () => {
		const newRef = reflection("ffffffffffff", [obsA.id]);
		mockAgents.runCurator.mockResolvedValueOnce({
			observations: [],
			reflections: [newRef],
			retiredIds: [],
			droppedIds: [obsA.id],
		});
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
			textCustomMessage("raw-2", "bbbbbbbb"),
		];
		const { fire, runLaunchedWork, pi, runtime } = setup({ entries });
		fire();
		await runLaunchedWork();
		expect(pi.appendEntry.mock.calls[0]).toEqual([
			OM_REFLECTIONS_RECORDED,
			{ reflections: [newRef], coversUpToId: "raw-1" },
		]);
		expect(pi.appendEntry.mock.calls[1]).toEqual([
			OM_OBSERVATIONS_DROPPED,
			{ observationIds: [obsA.id], coversUpToId: "raw-1" },
		]);
		expect(runtime.observerEmptyBackoff).toBeDefined();
	});

	it("aborts writes after session shutdown without warning", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		mockAgents.runCurator.mockImplementationOnce(async () => {
			await gate;
			return { observations: [obsA], reflections: [], retiredIds: [], droppedIds: [] };
		});
		const { fire, fireSessionShutdown, runLaunchedWork, pi, runtime, ctx } = setup({
			entries: [textCustomMessage("raw-1", "aaaaaaaa")],
		});
		fire();
		const running = runLaunchedWork();
		fireSessionShutdown();
		release();
		await running;
		expect(runtime.disposed).toBe(true);
		expect(pi.appendEntry).not.toHaveBeenCalled();
		expect(runtime.lastCuratorError).toBeUndefined();
		expect(ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("failed"), "warning");
	});

	it("does not treat a stale extension ctx as a curator failure", async () => {
		mockAgents.runCurator.mockResolvedValueOnce({
			observations: [obsA],
			reflections: [],
			retiredIds: [],
			droppedIds: [],
		});
		const { fire, runLaunchedWork, pi, runtime, ctx } = setup({ entries: [textCustomMessage("raw-1", "aaaaaaaa")] });
		pi.appendEntry.mockImplementation(() => {
			throw new Error(
				"This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.reload().",
			);
		});
		fire();
		await runLaunchedWork();
		expect(runtime.lastCuratorError).toBeUndefined();
		expect(runtime.disposed).toBe(true);
		expect(ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("failed"), "warning");
	});

	it("preserves curator failure boundaries", async () => {
		mockAgents.runCurator.mockRejectedValueOnce(new Error("curate failed"));
		const failed = setup({ entries: [textCustomMessage("raw-1", "aaaaaaaa")] });
		failed.fire();
		await failed.runLaunchedWork();
		expect(failed.runtime.lastCuratorError).toBe("curate failed");
		expect(failed.pi.appendEntry).not.toHaveBeenCalled();
	});

	it("suppresses routine worker notifications without hiding warnings", async () => {
		const { fire, runLaunchedWork, ctx, runtime } = setup({
			entries: [textCustomMessage("raw-1", "aaaaaaaa")],
			showWorkerNotifications: false,
		});
		mockAgents.runCurator.mockRejectedValueOnce(new Error("boom"));
		fire();
		await runLaunchedWork();
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("curator failed"), "warning");
		expect(ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("curator running"), "info");
		expect(runtime.lastCuratorError).toBe("boom");
	});
});

describe("curator chunk cap", () => {
	it("caps an oversized backlog and drains it incrementally across runs", async () => {
		const first = observation("111111111111", { sourceEntryIds: ["raw-1"], tokenCount: 4 });
		const second = observation("222222222222", { sourceEntryIds: ["raw-2"], tokenCount: 4 });
		mockAgents.runCurator
			.mockResolvedValueOnce({ observations: [first], reflections: [], retiredIds: [], droppedIds: [] })
			.mockResolvedValueOnce({ observations: [second], reflections: [], retiredIds: [], droppedIds: [] });
		const entries = [
			textCustomMessage("raw-1", "a".repeat(800)),
			textCustomMessage("raw-2", "b".repeat(800)),
			textCustomMessage("raw-3", "c".repeat(800)),
		];
		const { fire, runLaunchedWork, pi, runtime } = setup({
			entries,
			observerChunkMaxTokens: 256,
		});

		fire();
		await runLaunchedWork();
		expect(mockAgents.runCurator).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ allowedSourceEntryIds: ["raw-1"] }),
		);
		expect(pi.appendEntry).toHaveBeenNthCalledWith(1, OM_OBSERVATIONS_RECORDED, {
			observations: [first],
			coversUpToId: "raw-1",
		});

		runtime.consolidationInFlight = false;
		fire();
		await runLaunchedWork();
		expect(mockAgents.runCurator).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ allowedSourceEntryIds: ["raw-2"] }),
		);
		expect(pi.appendEntry).toHaveBeenNthCalledWith(2, OM_OBSERVATIONS_RECORDED, {
			observations: [second],
			coversUpToId: "raw-2",
		});
	});

	it("bounds one oversized tool result, preserves provenance, and continues on the next run", async () => {
		const first = observation("333333333333", { sourceEntryIds: ["raw-huge"], tokenCount: 4 });
		const second = observation("555555555555", { sourceEntryIds: ["raw-next"], tokenCount: 4 });
		mockAgents.runCurator
			.mockResolvedValueOnce({ observations: [first], reflections: [], retiredIds: [], droppedIds: [] })
			.mockResolvedValueOnce({ observations: [second], reflections: [], retiredIds: [], droppedIds: [] });
		const hugeText = `HEAD:${"m".repeat(2_000)}:TAIL`;
		const entries: TestEntry[] = [
			{
				type: "message",
				id: "raw-huge",
				parentId: null,
				timestamp: "2026-05-02T10:00:00.000Z",
				message: {
					role: "toolResult",
					toolCallId: "tool-1",
					toolName: "bash",
					content: [{ type: "text", text: hugeText }],
					isError: false,
					timestamp: Date.parse("2026-05-02T10:00:00.000Z"),
				},
			},
			textCustomMessage("raw-next", "later"),
		];
		const { fire, runLaunchedWork, pi, runtime } = setup({
			entries,
			observerChunkMaxTokens: 100,
		});

		fire();
		await runLaunchedWork();
		const firstCall = mockAgents.runCurator.mock.calls[0][0];
		expect(firstCall.allowedSourceEntryIds).toEqual(["raw-huge"]);
		expect(firstCall.chunk).toContain("HEAD:");
		expect(firstCall.chunk).toContain(":TAIL");
		expect(firstCall.chunk).toContain("middle omitted: source exceeds observer input budget");
		expect(firstCall.chunk).not.toContain("raw-next");
		expect(pi.appendEntry).toHaveBeenNthCalledWith(1, OM_OBSERVATIONS_RECORDED, {
			observations: [first],
			coversUpToId: "raw-huge",
		});

		runtime.consolidationInFlight = false;
		fire();
		await runLaunchedWork();
		expect(mockAgents.runCurator).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ allowedSourceEntryIds: ["raw-next"] }),
		);
	});

	it("derives the cap from the resolved model's context window when not configured", async () => {
		const obs = observation("444444444444", { sourceEntryIds: ["raw-1"], tokenCount: 4 });
		mockAgents.runCurator.mockResolvedValueOnce({
			observations: [obs],
			reflections: [],
			retiredIds: [],
			droppedIds: [],
		});
		const { fire, runLaunchedWork, runtime } = setup({
			entries: [textCustomMessage("raw-1", "a".repeat(800)), textCustomMessage("raw-2", "b".repeat(800))],
		});
		runtime.resolveModel.mockResolvedValue({
			ok: true,
			model: { reasoning: true, contextWindow: 1_280 },
			apiKey: "key",
			headers: { h: "v" },
		} as any);

		fire();
		await runLaunchedWork();
		expect(mockAgents.runCurator).toHaveBeenCalledWith(expect.objectContaining({ allowedSourceEntryIds: ["raw-1"] }));
	});

	it("keeps the launch-time config when project settings change mid-run", async () => {
		const first = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"], tokenCount: 4 });
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		mockAgents.runCurator.mockImplementationOnce(async () => {
			await gate;
			return { observations: [first], reflections: [], retiredIds: [], droppedIds: [] };
		});
		const { fire, runLaunchedWork, runtime } = setup({
			entries: [textCustomMessage("raw-1", "remember this"), textCustomMessage("raw-2", "and this")],
			observeAfterTokens: 1,
		});
		const launched = { ...runtime.config, observeAfterTokens: 1, agentMaxTurns: 3 };
		runtime.ensureConfig.mockReturnValue(launched);
		runtime.config = launched;

		fire();
		const work = runLaunchedWork();
		runtime.config = { ...runtime.config, observeAfterTokens: 1_000_000, agentMaxTurns: 99 };
		release?.();
		await work;

		expect(mockAgents.runCurator).toHaveBeenCalledWith(expect.objectContaining({ maxTurns: 3 }));
	});
});
