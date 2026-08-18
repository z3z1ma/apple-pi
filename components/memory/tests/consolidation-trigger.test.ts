import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAgents = vi.hoisted(() => ({
	runObserver: vi.fn(),
	runReflector: vi.fn(),
	runDropper: vi.fn(),
}));

vi.mock("../src/agents/observer/agent.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/agents/observer/agent.js")>()),
	runObserver: mockAgents.runObserver,
}));
vi.mock("../src/agents/reflector/agent.js", () => ({ runReflector: mockAgents.runReflector }));
vi.mock("../src/agents/dropper/agent.js", () => ({ runDropper: mockAgents.runDropper }));

import { ObserverStreamError } from "../src/agents/observer/agent.js";
import { registerConsolidationTrigger } from "../src/hooks/consolidation-trigger.js";
import { CONSOLIDATION_ABORT_REASON, errorFromAbortSignal, isQuietConsolidationAbort } from "../src/abort.js";
import { isStaleExtensionCtxError } from "../src/runtime.js";
import {
	OM_OBSERVATIONS_DROPPED,
	OM_OBSERVATIONS_RECORDED,
	OM_REFLECTIONS_RECORDED,
	OM_REFLECTIONS_RETIRED,
} from "../src/session-ledger/index.js";
import {
	observation,
	observationsDroppedEntry,
	observationsRecordedEntry,
	reflection,
	reflectionsRecordedEntry,
	reflectionsRetiredEntry,
	type TestEntry,
	textCustomMessage,
} from "./fixtures/session.js";

beforeEach(() => {
	mockAgents.runObserver.mockReset();
	mockAgents.runReflector.mockReset();
	mockAgents.runDropper.mockReset();
	mockAgents.runObserver.mockResolvedValue(undefined);
	mockAgents.runReflector.mockResolvedValue(undefined);
	mockAgents.runDropper.mockResolvedValue(undefined);
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
	appendEntryReturnsId?: boolean;
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
			return args.appendEntryReturnsId === false ? undefined : id;
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
		consolidationPhase: undefined as "observer" | "reflector" | "dropper" | undefined,
		resolveFailureNotified: false,
		lastObserverError: undefined as string | undefined,
		lastReflectorError: undefined as string | undefined,
		lastDropperError: undefined as string | undefined,
		observerEmptyBackoff: undefined as
			| { sessionIdentity: string | undefined; coverageId: string | undefined; tokensAtEmpty: number }
			| undefined,
		reflectorMaintenanceBackoff: undefined as
			| {
					sessionIdentity: string | undefined;
					observationCoverageId: string | undefined;
					tokensAtEmpty: number;
			  }
			| undefined,
		dropperNoDropBackoff: undefined as
			| {
					sessionIdentity: string | undefined;
					lawFingerprint: string;
					observationFingerprint: string;
					tokensAtEmpty: number;
			  }
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
		recordConsolidationStageError: vi.fn((ctx, phase: "observer" | "reflector" | "dropper", error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			if (isStaleExtensionCtxError(error) || isQuietConsolidationAbort(error)) return message;
			if (phase === "observer") runtime.lastObserverError = message;
			if (phase === "reflector") runtime.lastReflectorError = message;
			if (phase === "dropper") runtime.lastDropperError = message;
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
		addEntries: (...more: TestEntry[]) => {
			entries = [...entries, ...more];
		},
		setSessionId: (next: string) => {
			sessionId = next;
		},
		getEntries: () => entries,
	};
}

describe("V3 consolidation trigger", () => {
	const obsA = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"], tokenCount: 10 });
	const obsB = observation("bbbbbbbbbbbb", { sourceEntryIds: ["raw-2"], tokenCount: 10 });
	const refA = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"]);

	it("registers turn_end launch, agent_start abort, and session_shutdown", () => {
		const entries = [textCustomMessage("raw-1", "aaaaaaaa")];
		const { pi } = setup({ entries });

		expect(pi.on).toHaveBeenCalledWith("turn_end", expect.any(Function));
		expect(pi.on).toHaveBeenCalledWith("agent_start", expect.any(Function));
		expect(pi.on).toHaveBeenCalledWith("session_shutdown", expect.any(Function));
	});

	it("does not launch below all thresholds", () => {
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref", { reflections: [refA], coversUpToId: "raw-1" }),
			observationsDroppedEntry("om-drop", { observationIds: ["aaaaaaaaaaaa"], coversUpToId: "raw-1" }),
		];
		const { fireAgentStart, fireTurnEnd, runtime } = setup({ entries, observeAfterTokens: 10, reflectAfterTokens: 10 });

		fireAgentStart();
		fireTurnEnd();

		expect(runtime.launchConsolidationTask).not.toHaveBeenCalled();
	});

	it("does not launch in passive mode", () => {
		const entries = [textCustomMessage("raw-1", "aaaaaaaa")];
		const passive = setup({ entries, passive: true });

		passive.fireAgentStart();
		passive.fireTurnEnd();

		expect(passive.runtime.launchConsolidationTask).not.toHaveBeenCalled();
	});

	it("does not launch while consolidation is already in flight", () => {
		const entries = [textCustomMessage("raw-1", "aaaaaaaa")];
		const locked = setup({ entries, consolidationInFlight: true });

		locked.fireTurnEnd();

		expect(locked.runtime.launchConsolidationTask).not.toHaveBeenCalled();
	});

	it("does not launch from agent_start", () => {
		const entries = [textCustomMessage("raw-1", "aaaaaaaa")];
		const { fireAgentStart, runtime } = setup({ entries });

		fireAgentStart();

		expect(runtime.launchConsolidationTask).not.toHaveBeenCalled();
		expect(runtime.abortConsolidation).toHaveBeenCalledWith("observational-memory:user-turn");
	});

	it("launches from turn_end when work is due", () => {
		const entries = [textCustomMessage("raw-1", "aaaaaaaa")];
		const { fireTurnEnd, runtime } = setup({ entries });

		fireTurnEnd();

		expect(runtime.launchConsolidationTask).toHaveBeenCalledTimes(1);
	});

	it("aborts an in-flight run when a new user turn starts", () => {
		const entries = [textCustomMessage("raw-1", "aaaaaaaa")];
		const { fireAgentStart, fireTurnEnd, runtime } = setup({ entries });

		fireTurnEnd();
		fireAgentStart();

		expect(runtime.launchConsolidationTask).toHaveBeenCalledTimes(1);
		expect(runtime.abortConsolidation).toHaveBeenCalledWith("observational-memory:user-turn");
	});

	it("runs observer first and appends source-addressed observations", async () => {
		const obs = observation("cccccccccccc", { sourceEntryIds: ["raw-1"], tokenCount: 4 });
		mockAgents.runObserver.mockResolvedValueOnce([obs]);
		const entries = [textCustomMessage("raw-1", "aaaaaaaa")];
		const { fire, runLaunchedWork, pi, runtime } = setup({ entries, reflectAfterTokens: 999 });

		fire();
		await runLaunchedWork();

		expect(runtime.launchConsolidationTask).toHaveBeenCalled();
		expect(mockAgents.runObserver).toHaveBeenCalledWith(
			expect.objectContaining({
				allowedSourceEntryIds: ["raw-1"],
				maxTurns: 9,
				thinkingLevel: "minimal",
			}),
		);
		expect(pi.appendEntry).toHaveBeenCalledWith(OM_OBSERVATIONS_RECORDED, {
			observations: [obs],
			coversUpToId: "raw-1",
		});
	});

	it("forwards OAuth-shaped auth (headers, no apiKey) to the observer agent", async () => {
		const obs = observation("cccccccccccc", { sourceEntryIds: ["raw-1"], tokenCount: 4 });
		mockAgents.runObserver.mockResolvedValueOnce([obs]);
		const entries = [textCustomMessage("raw-1", "aaaaaaaa")];
		const { fire, runLaunchedWork, pi, runtime } = setup({ entries, reflectAfterTokens: 999 });
		runtime.resolveModel.mockResolvedValueOnce({
			ok: true,
			model: { provider: "kimi-coding" },
			apiKey: undefined,
			headers: { Authorization: "Bearer oauth-token" },
		});

		fire();
		await runLaunchedWork();

		expect(mockAgents.runObserver).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: undefined,
				headers: { Authorization: "Bearer oauth-token" },
			}),
		);
		expect(pi.appendEntry).toHaveBeenCalledWith(OM_OBSERVATIONS_RECORDED, {
			observations: [obs],
			coversUpToId: "raw-1",
		});
	});

	it("uses existing observation coverage and retries larger ranges after no-output", async () => {
		const prior = observation("cccccccccccc", { sourceEntryIds: ["raw-1"] });
		const newObs = observation("dddddddddddd", { sourceEntryIds: ["raw-2"] });
		mockAgents.runObserver.mockResolvedValueOnce([newObs]);
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			observationsRecordedEntry("om-prior", { observations: [prior], coversUpToId: "raw-1" }),
			textCustomMessage("raw-2", "bbbbbbbb"),
			textCustomMessage("raw-3", "cccccccc"),
		];
		const { fire, runLaunchedWork, pi } = setup({ entries, reflectAfterTokens: 999 });

		fire();
		await runLaunchedWork();

		expect(mockAgents.runObserver).toHaveBeenCalledWith(
			expect.objectContaining({ allowedSourceEntryIds: ["raw-2", "raw-3"] }),
		);
		expect(pi.appendEntry).toHaveBeenCalledWith(OM_OBSERVATIONS_RECORDED, {
			observations: [newObs],
			coversUpToId: "raw-3",
		});
	});

	it("observer no-output appends nothing and does not fake observation coverage", async () => {
		const entries = [textCustomMessage("raw-1", "aaaaaaaa")];
		const { fire, runLaunchedWork, pi } = setup({ entries });

		fire();
		await runLaunchedWork();

		expect(pi.appendEntry).not.toHaveBeenCalled();
		expect(mockAgents.runReflector).not.toHaveBeenCalled();
		expect(mockAgents.runDropper).not.toHaveBeenCalled();
	});

	it("shows routine worker notifications by default", async () => {
		const newRef = reflection("ffffffffffff", ["aaaaaaaaaaaa"]);
		mockAgents.runObserver.mockResolvedValueOnce([obsA]);
		mockAgents.runReflector.mockResolvedValueOnce({ reflections: [newRef], retiredIds: [] });
		mockAgents.runDropper.mockResolvedValueOnce(["aaaaaaaaaaaa"]);
		const entries = [textCustomMessage("raw-1", "aaaaaaaa")];
		const { fire, runLaunchedWork, ctx } = setup({ entries, observationsPoolTargetTokens: 5 });

		fire();
		await runLaunchedWork();

		expect(ctx.ui.notify.mock.calls).toEqual([
			[expect.stringMatching(/^Observational memory: observer running on ~\d+-token chunk$/), "info"],
			["Observational memory: 1 observation recorded", "info"],
			["Observational memory: reflector running (~2 tokens)", "info"],
			["Observational memory: dropper running — active observation pool ~19 / 5 target tokens (380%)", "info"],
		]);
	});

	it("suppresses routine worker notifications without hiding warnings", async () => {
		const newRef = reflection("ffffffffffff", ["aaaaaaaaaaaa"]);
		mockAgents.runObserver.mockResolvedValueOnce([obsA]);
		mockAgents.runReflector.mockResolvedValueOnce({ reflections: [newRef], retiredIds: [] });
		mockAgents.runDropper.mockResolvedValueOnce(["aaaaaaaaaaaa"]);
		const entries = [textCustomMessage("raw-1", "aaaaaaaa")];
		const quiet = setup({ entries, observationsPoolTargetTokens: 5, showWorkerNotifications: false });

		quiet.fire();
		await quiet.runLaunchedWork();

		expect(mockAgents.runObserver).toHaveBeenCalledOnce();
		expect(mockAgents.runReflector).toHaveBeenCalledOnce();
		expect(mockAgents.runDropper).toHaveBeenCalledOnce();
		expect(quiet.ctx.ui.notify).not.toHaveBeenCalled();

		// Deliberate empty is routine info: also hidden when quiet.
		mockAgents.runObserver.mockReset();
		mockAgents.runObserver.mockResolvedValueOnce(undefined);
		const noOutput = setup({ entries, reflectAfterTokens: 999, showWorkerNotifications: false });

		noOutput.fire();
		await noOutput.runLaunchedWork();

		expect(noOutput.ctx.ui.notify).not.toHaveBeenCalled();

		// Real failures still surface as warnings when quiet.
		mockAgents.runObserver.mockReset();
		mockAgents.runObserver.mockRejectedValueOnce(new ObserverStreamError("error", "prompt is too long"));
		const failed = setup({ entries, reflectAfterTokens: 999, showWorkerNotifications: false });

		failed.fire();
		await failed.runLaunchedWork();

		expect(failed.ctx.ui.notify).toHaveBeenCalledOnce();
		expect(failed.ctx.ui.notify.mock.calls[0][1]).toBe("warning");
		expect(failed.ctx.ui.notify.mock.calls[0][0]).toContain("observer failed");
	});

	it("reports deliberate empty as info, not a warning", async () => {
		const entries = [textCustomMessage("raw-1", "aaaaaaaa")];
		const { fire, runLaunchedWork, ctx } = setup({ entries, reflectAfterTokens: 999 });

		fire();
		await runLaunchedWork();

		expect(ctx.ui.notify.mock.calls).toEqual([
			[expect.stringMatching(/^Observational memory: observer running on ~\d+-token chunk$/), "info"],
			["Observational memory: observer found nothing new in this chunk (coverage unchanged; will retry later)", "info"],
		]);
	});

	it("backs off observer re-fires after a deliberate empty until enough new tokens arrive", async () => {
		const entries = [textCustomMessage("raw-1", "a".repeat(40))]; // 10 tokens
		const { fire, runLaunchedWork, addEntries, runtime } = setup({
			entries,
			observeAfterTokens: 10,
			reflectAfterTokens: 999,
		});

		fire();
		await runLaunchedWork();
		expect(mockAgents.runObserver).toHaveBeenCalledTimes(1);
		expect(runtime.observerEmptyBackoff).toEqual({
			sessionIdentity: "session-1",
			coverageId: undefined,
			tokensAtEmpty: 10,
		});

		// Same span, only 5 new tokens (< observeAfterTokens more): no re-fire.
		addEntries(textCustomMessage("raw-2", "b".repeat(20)));
		runtime.consolidationInFlight = false;
		fire();
		expect(runtime.launchConsolidationTask).toHaveBeenCalledTimes(2);
		await runLaunchedWork();
		expect(mockAgents.runObserver).toHaveBeenCalledTimes(1);

		// 10 more new tokens: backoff satisfied, observer re-fires over the grown span.
		addEntries(textCustomMessage("raw-3", "c".repeat(40)));
		runtime.consolidationInFlight = false;
		mockAgents.runObserver.mockResolvedValueOnce([obsA]);
		fire();
		await runLaunchedWork();
		expect(mockAgents.runObserver).toHaveBeenCalledTimes(2);
		expect(runtime.observerEmptyBackoff).toBeUndefined();
	});

	it("does not apply deliberate-empty backoff to another session", async () => {
		const entries = [textCustomMessage("raw-1", "a".repeat(40))];
		const { fire, runLaunchedWork, runtime, setSessionId } = setup({
			entries,
			observeAfterTokens: 10,
			reflectAfterTokens: 999,
		});

		fire();
		await runLaunchedWork();
		expect(mockAgents.runObserver).toHaveBeenCalledTimes(1);

		runtime.consolidationInFlight = false;
		setSessionId("session-2");
		fire();
		await runLaunchedWork();

		expect(mockAgents.runObserver).toHaveBeenCalledTimes(2);
	});

	it("surfaces API stream errors as observer failure, never as empty", async () => {
		mockAgents.runObserver.mockRejectedValueOnce(
			new ObserverStreamError("error", "prompt is too long: 5198507 tokens > 1000000 maximum"),
		);
		const entries = [textCustomMessage("raw-1", "aaaaaaaa")];
		const { fire, runLaunchedWork, pi, runtime, ctx } = setup({ entries, reflectAfterTokens: 999 });

		fire();
		await runLaunchedWork();

		expect(runtime.lastObserverError).toContain("prompt is too long");
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			'Observational memory: observer failed: observer stream ended with stopReason "error": prompt is too long: 5198507 tokens > 1000000 maximum',
			"warning",
		);
		expect(ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("no observations"), expect.anything());
		expect(pi.appendEntry).not.toHaveBeenCalled();
		expect(runtime.observerEmptyBackoff).toBeUndefined();
		expect(mockAgents.runReflector).not.toHaveBeenCalled();
	});

	it("silently aborts on signal-initiated ObserverStreamError('aborted')", async () => {
		mockAgents.runObserver.mockRejectedValueOnce(new ObserverStreamError("aborted"));
		const entries = [textCustomMessage("raw-1", "aaaaaaaa")];
		const { fire, runLaunchedWork, pi, runtime, ctx } = setup({ entries, reflectAfterTokens: 999 });
		// Simulate the consolidation signal being aborted (user-turn / dispose path).
		runtime.consolidationSignal = AbortSignal.abort("observational-memory:user-turn");

		fire();
		await runLaunchedWork();

		// Signal was aborted → silent abort, no error recording.
		expect(runtime.lastObserverError).toBeUndefined();
		expect(ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("failed"), expect.anything());
		expect(pi.appendEntry).not.toHaveBeenCalled();
		expect(mockAgents.runReflector).not.toHaveBeenCalled();
	});

	it("surfaces independent API aborts when the signal is not aborted", async () => {
		mockAgents.runObserver.mockRejectedValueOnce(new ObserverStreamError("aborted", "provider cancelled"));
		const entries = [textCustomMessage("raw-1", "aaaaaaaa")];
		const { fire, runLaunchedWork, pi, runtime, ctx } = setup({ entries, reflectAfterTokens: 999 });
		// Signal is NOT aborted — this is an independent API abort.
		runtime.consolidationSignal = new AbortController().signal;

		fire();
		await runLaunchedWork();

		// Independent API abort → recorded as error with notification.
		expect(runtime.lastObserverError).toContain("aborted");
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("observer failed"),
			"warning",
		);
		expect(pi.appendEntry).not.toHaveBeenCalled();
		expect(mockAgents.runReflector).not.toHaveBeenCalled();
	});

	it("stays quiet when runObserver rejects with a user-turn AbortError", async () => {
		const abortError = new Error(CONSOLIDATION_ABORT_REASON.userTurn);
		abortError.name = "AbortError";
		mockAgents.runObserver.mockRejectedValueOnce(abortError);
		const entries = [textCustomMessage("raw-1", "aaaaaaaa")];
		const { fire, runLaunchedWork, pi, runtime, ctx } = setup({ entries, reflectAfterTokens: 999 });

		fire();
		await runLaunchedWork();

		// user-turn AbortError is quiet: no lastObserverError, no warning notification.
		expect(runtime.lastObserverError).toBeUndefined();
		expect(ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("failed"), expect.anything());
		expect(pi.appendEntry).not.toHaveBeenCalled();
		expect(mockAgents.runReflector).not.toHaveBeenCalled();
	});

	it("model resolution failure skips appending and notifies once", async () => {
		const entries = [textCustomMessage("raw-1", "aaaaaaaa")];
		const { fire, runLaunchedWork, pi, runtime, ctx } = setup({ entries });
		runtime.resolveModel.mockResolvedValueOnce({ ok: false, reason: "no model" });

		fire();
		await runLaunchedWork();

		expect(pi.appendEntry).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenCalledWith("Observational memory: observer skipped — no model", "warning");
	});

	it("re-reads branch so observer append can unblock reflector in the same consolidation run", async () => {
		mockAgents.runObserver.mockResolvedValueOnce([obsA]);
		const newRef = reflection("ffffffffffff", ["aaaaaaaaaaaa"]);
		mockAgents.runReflector.mockResolvedValueOnce({ reflections: [newRef], retiredIds: [] });
		const entries = [textCustomMessage("raw-1", "aaaaaaaa")];
		const { fire, runLaunchedWork, pi } = setup({ entries });

		fire();
		await runLaunchedWork();

		expect(mockAgents.runObserver).toHaveBeenCalled();
		expect(mockAgents.runReflector).toHaveBeenCalledWith(expect.objectContaining({ observations: [obsA] }));
		expect(mockAgents.runObserver.mock.invocationCallOrder[0]).toBeLessThan(
			mockAgents.runReflector.mock.invocationCallOrder[0],
		);
		expect(pi.appendEntry.mock.calls[0]).toEqual([
			OM_OBSERVATIONS_RECORDED,
			{ observations: [obsA], coversUpToId: "raw-1" },
		]);
		expect(pi.appendEntry.mock.calls[1]).toEqual([
			OM_REFLECTIONS_RECORDED,
			{ reflections: [newRef], coversUpToId: "raw-1" },
		]);
	});

	it("checks newly reflected observations for one maintenance drop below the pool target", async () => {
		const newRef = reflection("ffffffffffff", ["aaaaaaaaaaaa"]);
		mockAgents.runReflector.mockResolvedValueOnce({ reflections: [newRef], retiredIds: [] });
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
			textCustomMessage("raw-2", "bbbbbbbb"),
			observationsDroppedEntry("om-drop", { observationIds: ["bbbbbbbbbbbb"], coversUpToId: "raw-2" }),
		];
		const { fire, runLaunchedWork, pi } = setup({ entries, observeAfterTokens: 999 });

		fire();
		await runLaunchedWork();

		expect(mockAgents.runReflector).toHaveBeenCalledWith(
			expect.objectContaining({ observations: [obsA], maxTurns: 9, thinkingLevel: "minimal" }),
		);
		expect(mockAgents.runDropper).toHaveBeenCalledWith(
			expect.objectContaining({
				reflections: [newRef],
				observations: [obsA],
				maintenanceEligibleObservationIds: ["aaaaaaaaaaaa"],
			}),
		);
		expect(pi.appendEntry).toHaveBeenCalledTimes(1);
		expect(pi.appendEntry).toHaveBeenCalledWith(OM_REFLECTIONS_RECORDED, {
			reflections: [newRef],
			coversUpToId: "raw-1",
		});
	});

	it("does not maintain observations for a same-run reflection that remains retired after persistence", async () => {
		const retiredRef = reflection("ffffffffffff", ["aaaaaaaaaaaa"]);
		mockAgents.runReflector.mockResolvedValueOnce({ reflections: [retiredRef], retiredIds: [] });
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref", { reflections: [retiredRef], coversUpToId: "raw-1" }),
			reflectionsRetiredEntry("om-retired", {
				reflectionIds: [retiredRef.id],
				coversUpToId: "raw-1",
			}),
			textCustomMessage("raw-2", "bbbbbbbb"),
		];
		const { fire, runLaunchedWork, pi } = setup({ entries, observeAfterTokens: 999 });

		fire();
		await runLaunchedWork();

		expect(pi.appendEntry).toHaveBeenCalledWith(OM_REFLECTIONS_RECORDED, {
			reflections: [retiredRef],
			coversUpToId: "raw-1",
		});
		expect(mockAgents.runDropper).not.toHaveBeenCalled();
	});

	it("appends a model-approved maintenance drop below the pool target", async () => {
		const newRef = reflection("ffffffffffff", ["aaaaaaaaaaaa"]);
		mockAgents.runReflector.mockResolvedValueOnce({ reflections: [newRef], retiredIds: [] });
		mockAgents.runDropper.mockResolvedValueOnce(["aaaaaaaaaaaa"]);
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
			textCustomMessage("raw-2", "bbbbbbbb"),
		];
		const { fire, runLaunchedWork, pi } = setup({ entries, observeAfterTokens: 999 });

		fire();
		await runLaunchedWork();

		expect(pi.appendEntry.mock.calls[0]).toEqual([
			OM_REFLECTIONS_RECORDED,
			{ reflections: [newRef], coversUpToId: "raw-1" },
		]);
		expect(pi.appendEntry.mock.calls[1]).toEqual([
			OM_OBSERVATIONS_DROPPED,
			{ observationIds: ["aaaaaaaaaaaa"], coversUpToId: "raw-1" },
		]);
	});

	it("runs dropper after same-run non-empty reflector output and appends non-empty drops", async () => {
		const newRef = reflection("ffffffffffff", ["aaaaaaaaaaaa"]);
		mockAgents.runReflector.mockResolvedValueOnce({ reflections: [newRef], retiredIds: [] });
		mockAgents.runDropper.mockResolvedValueOnce(["aaaaaaaaaaaa"]);
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
			textCustomMessage("raw-2", "bbbbbbbb"),
		];
		const { fire, runLaunchedWork, pi } = setup({ entries, observeAfterTokens: 999, observationsPoolTargetTokens: 5 });

		fire();
		await runLaunchedWork();

		expect(mockAgents.runReflector).toHaveBeenCalled();
		expect(mockAgents.runDropper).toHaveBeenCalledWith(
			expect.objectContaining({ reflections: [newRef], observations: [obsA] }),
		);
		expect(pi.appendEntry.mock.calls[0]).toEqual([
			OM_REFLECTIONS_RECORDED,
			{ reflections: [newRef], coversUpToId: "raw-1" },
		]);
		expect(pi.appendEntry.mock.calls[1]).toEqual([
			OM_OBSERVATIONS_DROPPED,
			{ observationIds: ["aaaaaaaaaaaa"], coversUpToId: "raw-1" },
		]);
	});

	it("launches dropper-only work when active pool is over target", async () => {
		mockAgents.runDropper.mockResolvedValueOnce(["aaaaaaaaaaaa"]);
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref", { reflections: [refA], coversUpToId: "raw-1" }),
		];
		const { fire, runLaunchedWork, runtime, pi } = setup({
			entries,
			observeAfterTokens: 999,
			reflectAfterTokens: 999,
			observationsPoolTargetTokens: 5,
		});

		fire();
		await runLaunchedWork();

		expect(runtime.launchConsolidationTask).toHaveBeenCalledTimes(1);
		expect(mockAgents.runObserver).not.toHaveBeenCalled();
		expect(mockAgents.runReflector).not.toHaveBeenCalled();
		expect(mockAgents.runDropper).toHaveBeenCalledWith(
			expect.objectContaining({ reflections: [refA], observations: [obsA] }),
		);
		expect(pi.appendEntry).toHaveBeenCalledWith(OM_OBSERVATIONS_DROPPED, {
			observationIds: ["aaaaaaaaaaaa"],
			coversUpToId: "raw-1",
		});
	});

	it("aborts dropper writes after session shutdown without warning", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		mockAgents.runDropper.mockImplementationOnce(async () => {
			await gate;
			return ["aaaaaaaaaaaa"];
		});
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref", { reflections: [refA], coversUpToId: "raw-1" }),
		];
		const { fire, fireSessionShutdown, runLaunchedWork, pi, runtime, ctx } = setup({
			entries,
			observeAfterTokens: 999,
			reflectAfterTokens: 999,
			observationsPoolTargetTokens: 5,
		});

		fire();
		const running = runLaunchedWork();
		fireSessionShutdown();
		release();
		await running;

		expect(runtime.disposed).toBe(true);
		expect(pi.appendEntry).not.toHaveBeenCalled();
		expect(runtime.lastDropperError).toBeUndefined();
		expect(ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("dropper failed"), "warning");
	});

	it("does not treat a stale extension ctx as a dropper failure", async () => {
		const stale = new Error(
			"This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.reload().",
		);
		mockAgents.runDropper.mockResolvedValueOnce(["aaaaaaaaaaaa"]);
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref", { reflections: [refA], coversUpToId: "raw-1" }),
		];
		const { fire, runLaunchedWork, pi, runtime, ctx } = setup({
			entries,
			observeAfterTokens: 999,
			reflectAfterTokens: 999,
			observationsPoolTargetTokens: 5,
		});
		pi.appendEntry.mockImplementation(() => {
			throw stale;
		});

		fire();
		await runLaunchedWork();

		expect(runtime.lastDropperError).toBeUndefined();
		expect(runtime.disposed).toBe(true);
		expect(ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("dropper failed"), "warning");
	});

	it("runs dropper when reflector emits nothing and the pool is over target", async () => {
		mockAgents.runDropper.mockResolvedValueOnce(["aaaaaaaaaaaa"]);
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
			textCustomMessage("raw-2", "bbbbbbbb"),
		];
		const { fire, runLaunchedWork, runtime, pi } = setup({
			entries,
			observeAfterTokens: 999,
			reflectAfterTokens: 1,
			observationsPoolTargetTokens: 5,
		});

		fire();
		await runLaunchedWork();

		expect(runtime.launchConsolidationTask).toHaveBeenCalledTimes(1);
		expect(mockAgents.runReflector).toHaveBeenCalled();
		expect(mockAgents.runDropper).toHaveBeenCalledWith(expect.objectContaining({ observations: [obsA] }));
		expect(pi.appendEntry).toHaveBeenCalledWith(OM_OBSERVATIONS_DROPPED, {
			observationIds: ["aaaaaaaaaaaa"],
			coversUpToId: "raw-1",
		});
	});

	it("does not launch dropper-only work when dropped tombstones reduce active pool below budget", () => {
		const heavy = observation("cccccccccccc", { sourceEntryIds: ["raw-1"], tokenCount: 100 });
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [heavy], coversUpToId: "raw-1" }),
			observationsDroppedEntry("om-drop", { observationIds: ["cccccccccccc"], coversUpToId: "raw-1" }),
			textCustomMessage("raw-2", "bbbbbbbb"),
			reflectionsRecordedEntry("om-ref", { reflections: [refA], coversUpToId: "raw-2" }),
		];
		const { fire, runtime } = setup({
			entries,
			observeAfterTokens: 999,
			reflectAfterTokens: 1,
			observationsPoolMaxTokens: 100,
		});

		fire();

		expect(runtime.launchConsolidationTask).not.toHaveBeenCalled();
	});

	it("uses same-run reflection coverage for drop coverage", async () => {
		const newRef = reflection("ffffffffffff", ["bbbbbbbbbbbb"]);
		mockAgents.runReflector.mockResolvedValueOnce({ reflections: [newRef], retiredIds: [] });
		mockAgents.runDropper.mockResolvedValueOnce(["bbbbbbbbbbbb"]);
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs-a", { observations: [obsA], coversUpToId: "raw-1" }),
			textCustomMessage("raw-2", "bbbbbbbb"),
			observationsRecordedEntry("om-obs-b", { observations: [obsB], coversUpToId: "raw-2" }),
		];
		const { fire, runLaunchedWork, pi } = setup({ entries, observeAfterTokens: 999, observationsPoolMaxTokens: 10 });

		fire();
		await runLaunchedWork();

		expect(pi.appendEntry.mock.calls[0]).toEqual([
			OM_REFLECTIONS_RECORDED,
			{ reflections: [newRef], coversUpToId: "raw-2" },
		]);
		expect(pi.appendEntry.mock.calls[1]).toEqual([
			OM_OBSERVATIONS_DROPPED,
			{ observationIds: ["bbbbbbbbbbbb"], coversUpToId: "raw-2" },
		]);
	});

	it("does not relaunch dropper after a no-drop verdict over an unchanged set", async () => {
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref", { reflections: [refA], coversUpToId: "raw-1" }),
		];
		const { fire, runLaunchedWork, runtime } = setup({
			entries,
			observeAfterTokens: 999,
			reflectAfterTokens: 999,
			observationsPoolTargetTokens: 5,
		});

		fire();
		await runLaunchedWork();
		expect(mockAgents.runDropper).toHaveBeenCalledTimes(1);

		runtime.consolidationInFlight = false;
		fire();

		expect(runtime.launchConsolidationTask).toHaveBeenCalledTimes(1);
	});

	it("appends reflection retirements from the same reflector pass", async () => {
		const newRef = reflection("ffffffffffff", ["aaaaaaaaaaaa"]);
		mockAgents.runReflector.mockResolvedValueOnce({
			reflections: [newRef],
			retiredIds: ["eeeeeeeeeeee"],
		});
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref", { reflections: [refA], coversUpToId: "raw-1" }),
			textCustomMessage("raw-2", "bbbbbbbb"),
		];
		const { fire, runLaunchedWork, pi } = setup({
			entries,
			observeAfterTokens: 999,
			observationsPoolTargetTokens: 1000,
		});

		fire();
		await runLaunchedWork();

		expect(pi.appendEntry.mock.calls[0]).toEqual([
			OM_REFLECTIONS_RECORDED,
			{ reflections: [newRef], coversUpToId: "raw-1" },
		]);
		expect(pi.appendEntry.mock.calls[1]).toEqual([
			OM_REFLECTIONS_RETIRED,
			{
				reflectionIds: ["eeeeeeeeeeee"],
				coversUpToId: "raw-1",
				successorIds: ["ffffffffffff"],
			},
		]);
		expect(mockAgents.runDropper).toHaveBeenCalledWith(
			expect.objectContaining({
				reflections: [newRef],
				maintenanceEligibleObservationIds: ["aaaaaaaaaaaa"],
			}),
		);
	});

	it("does not relaunch reflector after retire-only coverage on the current observation span", async () => {
		mockAgents.runReflector.mockResolvedValueOnce({
			reflections: [],
			retiredIds: ["eeeeeeeeeeee"],
		});
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs-1", { observations: [obsA], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref", { reflections: [refA], coversUpToId: "raw-1" }),
			textCustomMessage("raw-2", "bbbbbbbb"),
			observationsRecordedEntry("om-obs-2", { observations: [obsB], coversUpToId: "raw-2" }),
		];
		const { fire, runLaunchedWork, runtime, pi } = setup({
			entries,
			observeAfterTokens: 999,
			observationsPoolTargetTokens: 1000,
		});

		fire();
		await runLaunchedWork();
		expect(pi.appendEntry).toHaveBeenCalledWith(OM_REFLECTIONS_RETIRED, {
			reflectionIds: ["eeeeeeeeeeee"],
			coversUpToId: "raw-2",
		});

		runtime.consolidationInFlight = false;
		fire();

		expect(runtime.launchConsolidationTask).toHaveBeenCalledTimes(1);
		expect(mockAgents.runReflector).toHaveBeenCalledTimes(1);
	});

	it("does not relaunch reflector after a same-marker retire-only write", async () => {
		mockAgents.runReflector.mockResolvedValueOnce({
			reflections: [],
			retiredIds: ["eeeeeeeeeeee"],
		});
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref", { reflections: [refA], coversUpToId: "raw-1" }),
			textCustomMessage("raw-2", "bbbbbbbb"),
		];
		const { fire, runLaunchedWork, runtime, pi } = setup({
			entries,
			observeAfterTokens: 999,
			observationsPoolTargetTokens: 1000,
		});

		fire();
		await runLaunchedWork();
		expect(pi.appendEntry).toHaveBeenCalledWith(OM_REFLECTIONS_RETIRED, {
			reflectionIds: ["eeeeeeeeeeee"],
			coversUpToId: "raw-1",
		});

		runtime.consolidationInFlight = false;
		fire();

		expect(runtime.launchConsolidationTask).toHaveBeenCalledTimes(1);
		expect(mockAgents.runReflector).toHaveBeenCalledTimes(1);
	});

	it("does not append reflect/drop entries without observation coverage", async () => {
		mockAgents.runReflector.mockResolvedValueOnce({
			reflections: [reflection("ffffffffffff", ["aaaaaaaaaaaa"])],
			retiredIds: [],
		});
		mockAgents.runDropper.mockResolvedValueOnce(["aaaaaaaaaaaa"]);
		const entries = [textCustomMessage("raw-1", "aaaaaaaa")];
		const { fire, runLaunchedWork, pi } = setup({ entries, observeAfterTokens: 999 });

		fire();
		await runLaunchedWork();

		expect(mockAgents.runReflector).not.toHaveBeenCalled();
		expect(mockAgents.runDropper).not.toHaveBeenCalled();
		expect(pi.appendEntry).not.toHaveBeenCalled();
	});

	it("runs reflector before dropper and covers drops through same-run reflection coverage", async () => {
		const newRef = reflection("ffffffffffff", ["bbbbbbbbbbbb"]);
		mockAgents.runReflector.mockResolvedValueOnce({ reflections: [newRef], retiredIds: [] });
		mockAgents.runDropper.mockResolvedValueOnce(["bbbbbbbbbbbb"]);
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs-a", { observations: [obsA], coversUpToId: "raw-1" }),
			textCustomMessage("raw-2", "bbbbbbbb"),
			observationsRecordedEntry("om-obs-b", { observations: [obsB], coversUpToId: "raw-2" }),
		];
		const { fire, runLaunchedWork, pi } = setup({ entries, observeAfterTokens: 999, observationsPoolMaxTokens: 10 });

		fire();
		await runLaunchedWork();

		expect(mockAgents.runDropper).toHaveBeenCalledWith(expect.objectContaining({ reflections: [newRef] }));
		expect(pi.appendEntry.mock.calls[0]).toEqual([
			OM_REFLECTIONS_RECORDED,
			{ reflections: [newRef], coversUpToId: "raw-2" },
		]);
		expect(pi.appendEntry.mock.calls[1]).toEqual([
			OM_OBSERVATIONS_DROPPED,
			{ observationIds: ["bbbbbbbbbbbb"], coversUpToId: "raw-2" },
		]);
	});

	it("does not use appended reflection entry id for drop coverage when appendEntry returns no id", async () => {
		const newRef = reflection("ffffffffffff", ["bbbbbbbbbbbb"]);
		mockAgents.runReflector.mockResolvedValueOnce({ reflections: [newRef], retiredIds: [] });
		mockAgents.runDropper.mockResolvedValueOnce(["bbbbbbbbbbbb"]);
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs-a", { observations: [obsA], coversUpToId: "raw-1" }),
			textCustomMessage("raw-2", "bbbbbbbb"),
			observationsRecordedEntry("om-obs-b", { observations: [obsB], coversUpToId: "raw-2" }),
		];
		const { fire, runLaunchedWork, pi } = setup({
			entries,
			observeAfterTokens: 999,
			appendEntryReturnsId: false,
			observationsPoolMaxTokens: 10,
		});

		fire();
		await runLaunchedWork();

		expect(pi.appendEntry.mock.calls[1]).toEqual([
			OM_OBSERVATIONS_DROPPED,
			{ observationIds: ["bbbbbbbbbbbb"], coversUpToId: "raw-2" },
		]);
	});

	it("appends no empty reflection or drop entries", async () => {
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
		];
		const { fire, runLaunchedWork, pi, ctx } = setup({ entries, observeAfterTokens: 999 });

		fire();
		await runLaunchedWork();

		expect(pi.appendEntry).not.toHaveBeenCalled();
		expect(mockAgents.runDropper).not.toHaveBeenCalled();
		expect(ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("dropper running"), "info");
	});

	it("preserves stage failure boundaries", async () => {
		mockAgents.runObserver.mockRejectedValueOnce(new Error("observe failed"));
		const observerFailure = setup({ entries: [textCustomMessage("raw-1", "aaaaaaaa")] });
		observerFailure.fire();
		await observerFailure.runLaunchedWork();
		expect(observerFailure.runtime.lastObserverError).toBe("observe failed");
		expect(mockAgents.runReflector).not.toHaveBeenCalled();
		expect(mockAgents.runDropper).not.toHaveBeenCalled();

		mockAgents.runObserver.mockReset();
		mockAgents.runObserver.mockResolvedValue(undefined);
		mockAgents.runReflector.mockReset();
		mockAgents.runReflector.mockRejectedValueOnce(new Error("reflect failed"));
		const reflectorFailure = setup({
			entries: [
				textCustomMessage("raw-1", "aaaaaaaa"),
				observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
			],
			observeAfterTokens: 999,
		});
		reflectorFailure.fire();
		await reflectorFailure.runLaunchedWork();
		expect(reflectorFailure.runtime.lastReflectorError).toBe("reflect failed");
		expect(mockAgents.runDropper).not.toHaveBeenCalled();
		expect(reflectorFailure.pi.appendEntry).not.toHaveBeenCalled();

		mockAgents.runReflector.mockReset();
		const newRef = reflection("ffffffffffff", ["aaaaaaaaaaaa"]);
		mockAgents.runReflector.mockResolvedValueOnce({ reflections: [newRef], retiredIds: [] });
		mockAgents.runDropper.mockReset();
		mockAgents.runDropper.mockRejectedValueOnce(new Error("drop failed"));
		const dropperFailure = setup({
			entries: [
				textCustomMessage("raw-1", "aaaaaaaa"),
				observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
			],
			observeAfterTokens: 999,
			observationsPoolMaxTokens: 10,
		});
		dropperFailure.fire();
		await dropperFailure.runLaunchedWork();
		expect(dropperFailure.runtime.lastDropperError).toBe("drop failed");
		expect(dropperFailure.pi.appendEntry).toHaveBeenCalledTimes(1);
		expect(dropperFailure.pi.appendEntry).toHaveBeenCalledWith(OM_REFLECTIONS_RECORDED, {
			reflections: [newRef],
			coversUpToId: "raw-1",
		});
	});
});

describe("observer chunk cap", () => {
	it("caps an oversized backlog and drains it incrementally across runs", async () => {
		const first = observation("111111111111", { sourceEntryIds: ["raw-1"], tokenCount: 4 });
		const second = observation("222222222222", { sourceEntryIds: ["raw-2"], tokenCount: 4 });
		mockAgents.runObserver.mockResolvedValueOnce([first]).mockResolvedValueOnce([second]);
		const entries = [
			textCustomMessage("raw-1", "a".repeat(800)),
			textCustomMessage("raw-2", "b".repeat(800)),
			textCustomMessage("raw-3", "c".repeat(800)),
		];
		const { fire, runLaunchedWork, pi, runtime } = setup({
			entries,
			observerChunkMaxTokens: 256,
			reflectAfterTokens: 999,
		});

		fire();
		await runLaunchedWork();

		// Only the oldest entry fits under the cap; coverage advances to it, not to the backlog tail.
		expect(mockAgents.runObserver).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ allowedSourceEntryIds: ["raw-1"] }),
		);
		expect(pi.appendEntry).toHaveBeenNthCalledWith(1, OM_OBSERVATIONS_RECORDED, {
			observations: [first],
			coversUpToId: "raw-1",
		});

		// The next run continues from the advanced coverage.
		runtime.consolidationInFlight = false;
		fire();
		await runLaunchedWork();

		expect(mockAgents.runObserver).toHaveBeenNthCalledWith(
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
		mockAgents.runObserver.mockResolvedValueOnce([first]).mockResolvedValueOnce([second]);
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
			reflectAfterTokens: 999,
		});

		fire();
		await runLaunchedWork();

		const firstCall = mockAgents.runObserver.mock.calls[0][0];
		expect(firstCall.allowedSourceEntryIds).toEqual(["raw-huge"]);
		expect(firstCall.chunk).toContain("HEAD:");
		expect(firstCall.chunk).toContain(":TAIL");
		expect(firstCall.chunk).toContain("middle omitted: source exceeds observer input budget");
		expect(firstCall.chunk).not.toContain("raw-next");
		expect(pi.appendEntry).toHaveBeenNthCalledWith(1, OM_OBSERVATIONS_RECORDED, {
			observations: [first],
			coversUpToId: "raw-huge",
		});

		// The source id still points at the full ledger entry; the next run starts
		// after it instead of retrying the oversized input forever.
		runtime.consolidationInFlight = false;
		fire();
		await runLaunchedWork();

		expect(mockAgents.runObserver).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ allowedSourceEntryIds: ["raw-next"] }),
		);
		expect(pi.appendEntry).toHaveBeenNthCalledWith(2, OM_OBSERVATIONS_RECORDED, {
			observations: [second],
			coversUpToId: "raw-next",
		});
	});

	it("derives the cap from the resolved model's context window when not configured", async () => {
		const obs = observation("444444444444", { sourceEntryIds: ["raw-1"], tokenCount: 4 });
		mockAgents.runObserver.mockResolvedValueOnce([obs]);
		const entries = [textCustomMessage("raw-1", "a".repeat(800)), textCustomMessage("raw-2", "b".repeat(800))];
		const { fire, runLaunchedWork, pi, runtime } = setup({ entries, reflectAfterTokens: 999 });
		// contextWindow 1,280 -> cap = floor(1,280 * 0.2) = 256, so only raw-1 fits.
		runtime.resolveModel.mockResolvedValue({
			ok: true,
			model: { reasoning: true, contextWindow: 1_280 },
			apiKey: "key",
			headers: { h: "v" },
		} as any);

		fire();
		await runLaunchedWork();

		expect(mockAgents.runObserver).toHaveBeenCalledWith(expect.objectContaining({ allowedSourceEntryIds: ["raw-1"] }));
		expect(pi.appendEntry).toHaveBeenCalledWith(
			OM_OBSERVATIONS_RECORDED,
			expect.objectContaining({ coversUpToId: "raw-1" }),
		);
	});

	it("keeps the launch-time config when project settings change mid-run", async () => {
		const first = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"], tokenCount: 4 });
		const second = observation("bbbbbbbbbbbb", { sourceEntryIds: ["raw-2"], tokenCount: 4 });
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		mockAgents.runObserver.mockImplementationOnce(async () => {
			await gate;
			return [first];
		});
		const { fire, runLaunchedWork, pi, runtime } = setup({
			entries: [textCustomMessage("raw-1", "remember this"), textCustomMessage("raw-2", "and this")],
			observeAfterTokens: 1,
			reflectAfterTokens: 999,
		});
		const launched = { ...runtime.config, observeAfterTokens: 1, agentMaxTurns: 3 };
		runtime.ensureConfig.mockReturnValue(launched);
		runtime.config = launched;

		fire();
		const work = runLaunchedWork();
		runtime.config = { ...runtime.config, observeAfterTokens: 1_000_000, agentMaxTurns: 99 };
		release?.();
		await work;

		expect(mockAgents.runObserver).toHaveBeenCalledWith(expect.objectContaining({ maxTurns: 3 }));
		expect(pi.appendEntry).toHaveBeenCalledWith(
			OM_OBSERVATIONS_RECORDED,
			expect.objectContaining({ observations: [first] }),
		);
		expect(second.id).toBe("bbbbbbbbbbbb");
	});
});
