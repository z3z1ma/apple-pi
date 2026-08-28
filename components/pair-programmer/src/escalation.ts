import { createHash } from "node:crypto";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
	buildConsultationContext,
	captureConsultationWorkingState,
	type ConsultationContext,
	type ConsultationSource,
	type AdvisorConsultationResult,
	type EvidencePointer,
} from "../../subagents/src/consultation.js";
import type { ManagedSubagentService } from "../../subagents/src/service.js";
import type { PairNote, EscalationOutcome, PairEscalation, PairEscalationState } from "./types.js";

const evidencePointerSchema = Type.Object({
	kind: Type.Union([
		Type.Literal("call"),
		Type.Literal("file"),
		Type.Literal("symbol"),
		Type.Literal("diff"),
		Type.Literal("command"),
		Type.Literal("notebook"),
		Type.Literal("session"),
	]),
	ref: Type.String({ minLength: 1 }),
	path: Type.Optional(Type.String()),
	description: Type.Optional(Type.String()),
});

const escalationSchema = Type.Object({
	severity: Type.Union([Type.Literal("concern"), Type.Literal("blocker")]),
	claim: Type.String({ minLength: 1 }),
	why_deep_reasoning: Type.String({ minLength: 1 }),
	evidence: Type.Optional(Type.Array(evidencePointerSchema)),
	uncertainty: Type.Optional(Type.String()),
	topic: Type.Optional(Type.String()),
});

export type EscalationAcceptance = "accepted" | "suppressed" | "unavailable";

/** Private pairing capability. It can ask for a second opinion, not dispatch an agent. */
export class EscalateTool {
	readonly name = "ask_advisor";
	readonly label = "Escalate to Advisor";
	readonly description =
		"Ask a senior software architect for an independent second opinion on one consequential concern that is hard to verify cheaply. Explain what worries you, what you observed, and where you remain unsure. Asking does not make the concern true. Do not use this for nits, generic uncertainty, known errors, or routine reassurance.";
	readonly parameters = escalationSchema as any;

	constructor(private readonly onEscalation: (request: PairEscalation) => EscalationAcceptance) {}

	async execute(
		_id: string,
		args: {
			severity: "concern" | "blocker";
			claim: string;
			why_deep_reasoning: string;
			evidence?: EvidencePointer[];
			uncertainty?: string;
			topic?: string;
		},
	): Promise<AgentToolResult<unknown>> {
		const acceptance = this.onEscalation({
			severity: args.severity,
			claim: args.claim.trim(),
			whyDeepReasoning: args.why_deep_reasoning.trim(),
			evidence: args.evidence ?? [],
			...(args.uncertainty?.trim() ? { uncertainty: args.uncertainty.trim() } : {}),
			...(args.topic?.trim() ? { topic: args.topic.trim() } : {}),
		});
		const text =
			acceptance === "accepted"
				? "The software architect has been asked to take a deeper look."
				: acceptance === "suppressed"
					? "You already asked about an equivalent concern recently."
					: "The software architect is unavailable, so no second opinion was started and no note was produced.";
		return { content: [{ type: "text", text }], details: { acceptance } };
	}
}

function normalized(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function identityOf(request: PairEscalation): { key: string; evidence: string } {
	const paths = request.evidence
		.flatMap((item) => (item.path ? [item.path] : item.kind === "file" ? [item.ref] : []))
		.map(normalized)
		.sort();
	const topic = normalized(request.topic || request.claim);
	const evidence = hash(
		JSON.stringify(
			request.evidence.map((item) => ({
				kind: item.kind,
				ref: normalized(item.ref),
				path: item.path ? normalized(item.path) : undefined,
			})),
		),
	);
	return { key: hash(`${topic}\n${paths.join("\n")}`), evidence };
}

const severityRank = (severity: "concern" | "blocker"): number => (severity === "blocker" ? 2 : 1);

interface QueuedEscalation {
	id: string;
	source: ConsultationSource;
	request: PairEscalation;
	turn: number;
	identity: ReturnType<typeof identityOf>;
	triggerFeatures: ConsultationContext["metadata"]["triggerFeatures"];
}

interface DeliveryCandidate {
	queued: QueuedEscalation;
	context: ConsultationContext;
	result: AdvisorConsultationResult;
	note: PairNote;
	outcome: EscalationOutcome;
}

export type PreparedPairDelivery = {
	note: PairNote;
	commit(delivered: boolean): void;
};

export interface EscalationControllerStats {
	requests: number;
	suppressed: number;
	consultations: number;
	confirm: number;
	refute: number;
	refine: number;
	uncertain: number;
	failed: number;
	stale: number;
	delivered: number;
	input: number;
	output: number;
	cost: number;
}

export const MIN_TURNS_BETWEEN_ADVISOR = 2;

/** Conservative host gate: the exact same failing command must recur three times. */
export class RepeatedFailureDetector {
	#failures = new Map<string, { count: number; lastTurn: number; callIds: string[] }>();

	observe(
		message:
			| { content?: ReadonlyArray<{ type?: string; id?: string; name?: string; arguments?: unknown }> }
			| undefined,
		results: ReadonlyArray<{ toolCallId?: string; toolName?: string; isError?: boolean }>,
		turn: number,
	): PairEscalation | undefined {
		const commands = new Map<string, string>();
		for (const part of message?.content ?? []) {
			if (part.type !== "toolCall" || part.name !== "bash" || !part.id) continue;
			const args =
				part.arguments && typeof part.arguments === "object" ? (part.arguments as Record<string, unknown>) : {};
			if (typeof args.command === "string") commands.set(part.id, args.command.trim().replace(/\s+/g, " "));
		}
		for (const result of results) {
			if (result.toolName !== "bash" || !result.toolCallId) continue;
			const command = commands.get(result.toolCallId);
			if (!command) continue;
			const key = normalized(command);
			if (!result.isError) {
				this.#failures.delete(key);
				continue;
			}
			const previous = this.#failures.get(key);
			const current =
				previous && turn - previous.lastTurn <= 6
					? { count: previous.count + 1, lastTurn: turn, callIds: [...previous.callIds, result.toolCallId].slice(-3) }
					: { count: 1, lastTurn: turn, callIds: [result.toolCallId] };
			this.#failures.set(key, current);
			if (current.count === 3) {
				return {
					severity: "concern",
					claim: `The command \`${command}\` has failed three times without measurable progress.`,
					whyDeepReasoning:
						"Repeated materially identical failure suggests the current hypothesis or repair strategy may be wrong.",
					evidence: current.callIds.map((id) => ({ kind: "call", ref: `call:${id}` })),
					uncertainty: "The repeated failures may still be expected while one coherent fix is in progress.",
					topic: `repeated failure: ${command}`,
				};
			}
		}
		return undefined;
	}

	reset(): void {
		this.#failures.clear();
	}
}

/** One-concurrent-call supervisory state machine. No lifetime or per-task maximum is imposed. */
export class PairEscalationController {
	state: PairEscalationState = "idle";
	readonly stats: EscalationControllerStats = {
		requests: 0,
		suppressed: 0,
		consultations: 0,
		confirm: 0,
		refute: 0,
		refine: 0,
		uncertain: 0,
		failed: 0,
		stale: 0,
		delivered: 0,
		input: 0,
		output: 0,
		cost: 0,
	};

	#pending = new Map<string, QueuedEscalation>();
	#seen = new Map<string, { evidence: string; severity: number }>();
	#active: QueuedEscalation | undefined;
	#activeAbort: AbortController | undefined;
	#delivery: DeliveryCandidate | undefined;
	#turn = 0;
	#lastStartedTurn = Number.NEGATIVE_INFINITY;
	#counter = 0;
	#disposed = false;

	constructor(
		private readonly deps: {
			pi: ExtensionAPI;
			getContext(): ExtensionContext | undefined;
			getService(): ManagedSubagentService | undefined;
			onDeliveryReady(): void;
			onOutcome(outcome: EscalationOutcome): void;
			onStateChange(): void;
			minTurnsBetween?: number;
		},
	) {}

	get activeId(): string | undefined {
		return this.#active?.id ?? this.#delivery?.queued.id;
	}

	get pendingCount(): number {
		return this.#pending.size;
	}

	submit(
		source: ConsultationSource,
		request: PairEscalation,
		turn: number,
		triggerFeatures: QueuedEscalation["triggerFeatures"] = {},
	): EscalationAcceptance {
		if (this.#disposed) return "unavailable";
		this.stats.requests++;
		this.#turn = Math.max(this.#turn, turn);
		const identity = identityOf(request);
		const prior = this.#seen.get(identity.key);
		const rank = severityRank(request.severity);
		if (prior && prior.evidence === identity.evidence && prior.severity >= rank) {
			this.stats.suppressed++;
			return "suppressed";
		}
		const queued: QueuedEscalation = {
			id: `${identity.key.slice(0, 12)}-${++this.#counter}`,
			source,
			request,
			turn,
			identity,
			triggerFeatures,
		};
		this.#seen.set(identity.key, { evidence: identity.evidence, severity: rank });
		this.#pending.set(identity.key, queued);
		this.state = "escalation_pending";
		this.deps.onStateChange();
		void this.#pump();
		return this.deps.getService() ? "accepted" : "unavailable";
	}

	advanceTurn(turn: number): void {
		if (this.#disposed) return;
		this.#turn = Math.max(this.#turn, turn);
		void this.#pump();
	}

	async prepareDelivery(): Promise<PreparedPairDelivery | undefined> {
		const candidate = this.#delivery;
		const ctx = this.deps.getContext();
		if (!candidate || !ctx || this.#disposed) return undefined;
		const current = await captureConsultationWorkingState(
			this.deps.pi,
			ctx.cwd,
			candidate.context.workingState.fingerprintedPaths,
		);
		if (current.relevanceFingerprint !== candidate.context.workingState.relevanceFingerprint) {
			candidate.outcome.stale = true;
			this.stats.stale++;
			this.#finishDelivery(candidate, false);
			return undefined;
		}
		let committed = false;
		return {
			note: candidate.note,
			commit: (delivered) => {
				if (committed || this.#delivery !== candidate) return;
				committed = true;
				if (delivered) this.stats.delivered++;
				this.#finishDelivery(candidate, delivered);
			},
		};
	}

	cancel(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#activeAbort?.abort();
		this.#pending.clear();
		this.#delivery = undefined;
		this.state = "cancelled";
		this.deps.onStateChange();
	}

	#finishDelivery(candidate: DeliveryCandidate, delivered: boolean): void {
		candidate.outcome.delivered = delivered;
		this.deps.onOutcome(candidate.outcome);
		if (this.#delivery === candidate) this.#delivery = undefined;
		this.state = this.#active ? "advisor_running" : this.#pending.size ? "escalation_pending" : "idle";
		this.deps.onStateChange();
		void this.#pump();
	}

	async #pump(): Promise<void> {
		if (this.#disposed || this.#active || this.#delivery || this.#pending.size === 0) return;
		const minimum = this.deps.minTurnsBetween ?? MIN_TURNS_BETWEEN_ADVISOR;
		if (this.#turn - this.#lastStartedTurn < minimum) return;
		const ctx = this.deps.getContext();
		if (!ctx) return;
		const queued = this.#pending.values().next().value as QueuedEscalation | undefined;
		if (!queued) return;
		this.#pending.delete(queued.identity.key);
		this.#active = queued;
		this.#activeAbort = new AbortController();
		this.#lastStartedTurn = this.#turn;
		this.state = "advisor_running";
		this.stats.consultations++;
		this.deps.onStateChange();
		await this.#run(queued, ctx, this.#activeAbort.signal);
		this.#active = undefined;
		this.#activeAbort = undefined;
		if (!this.#delivery) {
			this.state = this.#pending.size ? "escalation_pending" : "idle";
			this.deps.onStateChange();
			void this.#pump();
		}
	}

	async #run(queued: QueuedEscalation, ctx: ExtensionContext, signal: AbortSignal): Promise<void> {
		let context: ConsultationContext;
		try {
			context = await buildConsultationContext({
				pi: this.deps.pi,
				ctx,
				source: queued.source,
				trajectorySequence: queued.turn,
				hypothesis: queued.request,
				triggerFeatures: queued.triggerFeatures,
			});
		} catch {
			this.stats.failed++;
			this.state = "failed";
			this.deps.onOutcome({
				id: queued.id,
				source: queued.source,
				originalSeverity: queued.request.severity,
				finalSeverity: queued.request.severity,
				delivered: false,
				stale: false,
				adoption: "unknown",
				validationOutcome: "unknown",
				status: "failed",
				usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, cost: 0, durationMs: 0, toolCalls: 0 },
			});
			this.deps.onStateChange();
			return;
		}
		const service = this.deps.getService();
		let result: AdvisorConsultationResult;
		try {
			result = service
				? await service.runConsultation(ctx, { context, signal })
				: {
						status: "failed",
						error: "Managed Advisor consultation service is unavailable.",
						usage: {
							input: 0,
							cacheRead: 0,
							cacheWrite: 0,
							output: 0,
							cost: 0,
							durationMs: 0,
							toolCalls: 0,
						},
					};
		} catch (error) {
			result = {
				status: signal.aborted ? "cancelled" : "failed",
				error: error instanceof Error ? error.message : String(error),
				usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, cost: 0, durationMs: 0, toolCalls: 0 },
			};
		}
		if (this.#disposed) return;
		this.stats.input += result.usage.input;
		this.stats.output += result.usage.output;
		this.stats.cost += result.usage.cost;
		const outcome: EscalationOutcome = {
			id: queued.id,
			source: queued.source,
			disposition: result.finding?.disposition,
			originalSeverity: queued.request.severity,
			finalSeverity: result.finding?.severity ?? queued.request.severity,
			delivered: false,
			stale: false,
			adoption: "unknown",
			validationOutcome: "unknown",
			status: result.status,
			usage: result.usage,
		};
		const finding = result.finding;
		const disposition = finding?.disposition;
		if (disposition) this.stats[disposition]++;
		if (result.status === "failed" || result.status === "malformed") this.stats.failed++;
		const deliverable =
			result.status === "completed" && finding !== undefined && (disposition === "confirm" || disposition === "refine");
		if (!deliverable) {
			this.state =
				result.status === "cancelled" ? "cancelled" : result.status === "completed" ? "advisor_settled" : "failed";
			this.deps.onOutcome(outcome);
			this.deps.onStateChange();
			return;
		}
		this.#delivery = {
			queued,
			context,
			result,
			note: {
				note: [finding.finding, finding.recommendedAction].filter(Boolean).join("\n\n"),
				severity: finding.severity ?? queued.request.severity,
				source: "advisor",
				adjudication: disposition,
			},
			outcome,
		};
		this.state = "delivery_pending";
		this.deps.onStateChange();
		this.deps.onDeliveryReady();
	}
}
