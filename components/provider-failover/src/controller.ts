import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { isContextOverflow, isRetryableAssistantError } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PROGRAM_ID_ENV } from "../../session-state/src/protocol.js";
import { inForkedContinuation } from "../../shared/src/fork-context.js";
import { ModelProfileError, type ResolvedModelProfile } from "../../shared/src/model-profiles.js";
import { classifyTerminalProviderFailure } from "./classify.js";
import { failoverCandidates, nextFailoverCandidate, requiresImages } from "./policy.js";

type Selection = { provider: string; id: string; thinking: ModelThinkingLevel };
type Episode = {
	controller: AbortController;
	candidates: ResolvedModelProfile[];
	attempted: Set<string>;
	userEntry: string | undefined;
	failureEntry: string;
	selecting?: { model: Model<Api>; previous: Model<Api> };
	selection?: Selection;
	pending?: { signal: AbortSignal; requested: boolean; nativeRetry: boolean };
};

function excluded(): boolean {
	return Boolean(process.env[PROGRAM_ID_ENV]) || inForkedContinuation();
}

function lastUserEntry(ctx: ExtensionContext): string | undefined {
	return ctx.sessionManager.getBranch().findLast((entry) => entry.type === "message" && entry.message.role === "user")
		?.id;
}

function matches(model: Model<Api> | undefined, selection: { provider: string; id: string }): boolean {
	return model?.provider === selection.provider && model.id === selection.id;
}

function eligibleSelection(
	ctx: ExtensionContext,
	selection: { provider: string; id: string },
	needsImages: boolean,
): boolean {
	const registered = ctx.modelRegistry.find(selection.provider, selection.id);
	return Boolean(
		matches(ctx.model, selection) &&
			registered &&
			registered.api !== "pi-virtual" &&
			ctx.modelRegistry.hasConfiguredAuth(registered) &&
			(!needsImages || registered.input.includes("image")),
	);
}

function nativeRetryable(message: Parameters<typeof isContextOverflow>[0], contextWindow: number): boolean {
	return !isContextOverflow(message, contextWindow) && isRetryableAssistantError(message);
}

function stoppedSelectionMessage(ctx: ExtensionContext): string {
	const model = ctx.model;
	const selection = model ? `${model.provider}/${model.id} is currently selected.` : "No model is currently selected.";
	return `Provider failover stopped: model selection was interrupted or unavailable. ${selection} No restoration was attempted.`;
}

export default function installProviderFailover(pi: ExtensionAPI): void {
	let active = false;
	let suppressed = false;
	let episode: Episode | undefined;

	function isCurrent(current: Episode, signal: AbortSignal): boolean {
		return current === episode && !signal.aborted;
	}

	function clear(): Episode | undefined {
		const previous = episode;
		episode = undefined;
		previous?.controller.abort();
		return previous;
	}

	function report(ctx: ExtensionContext, message: string): void {
		pi.appendEntry("provider-failover", { message });
		if (ctx.hasUI) ctx.ui.notify(message, "warning");
		else console.warn(`[provider-failover] ${message}`);
	}

	function stop(ctx: ExtensionContext, message: string): void {
		clear();
		suppressed = true;
		ctx.abort();
		report(ctx, message);
	}

	function interrupt(ctx: ExtensionContext): void {
		const previous = clear();
		suppressed = true;
		if (previous?.pending) ctx.abort();
	}

	pi.on("session_start", () => {
		if (excluded()) return;
		clear();
		suppressed = false;
		active = true;
	});

	pi.on("input", () => {
		if (excluded()) return;
		clear();
		suppressed = false;
	});
	pi.on("before_agent_start", () => {
		if (excluded()) return;
		clear();
		suppressed = false;
	});
	pi.on("model_select", (event, ctx) => {
		if (excluded() || !episode) return;
		const selecting = episode.selecting;
		if (selecting && matches(event.model, selecting.model) && matches(event.previousModel, selecting.previous)) return;
		interrupt(ctx);
	});
	pi.on("thinking_level_select", (_event, ctx) => {
		if (excluded() || !episode) return;
		if (episode.selecting && matches(ctx.model, episode.selecting.model)) return;
		if (episode.selecting || (episode.selection && pi.getThinkingLevel() !== episode.selection.thinking))
			interrupt(ctx);
	});
	pi.on("session_before_switch", (_event, ctx) => {
		if (!excluded()) interrupt(ctx);
	});
	pi.on("session_before_fork", (_event, ctx) => {
		if (!excluded()) interrupt(ctx);
	});
	pi.on("session_before_tree", (_event, ctx) => {
		if (!excluded()) interrupt(ctx);
	});
	pi.on("session_shutdown", () => {
		if (excluded()) return;
		clear();
		active = false;
		suppressed = true;
	});
	pi.on("agent_settled", () => {
		if (excluded()) return;
		clear();
		suppressed = false;
	});

	pi.on("turn_end", async (event, ctx) => {
		if (!active || excluded()) return;
		if (episode && event.message.role === "assistant") episode.pending = undefined;
		const message = event.message;
		const source = ctx.model;
		if (
			suppressed ||
			message.role !== "assistant" ||
			message.stopReason !== "error" ||
			!message.errorMessage ||
			!source
		)
			return;
		if (!matches(source, { provider: message.provider, id: message.model }) || source.api === "pi-virtual") return;
		const reason = classifyTerminalProviderFailure(source.provider, message.errorMessage);
		if (!reason || ctx.signal?.aborted) return;
		let current = episode;
		try {
			if (!current) {
				current = {
					controller: new AbortController(),
					candidates: failoverCandidates(ctx),
					attempted: new Set(),
					userEntry: lastUserEntry(ctx),
					failureEntry: event.messageEntryId,
				};
				episode = current;
			}
			current.attempted.add(source.provider);
			const needsImages = requiresImages([...event.context.llmMessages, ...event.context.pendingMessages]);
			const candidate = nextFailoverCandidate(current.candidates, current.attempted, needsImages);
			if (!candidate) {
				stop(
					ctx,
					`Provider failover stopped after ${source.provider} ${reason}: no eligible distinct provider remains in the workload profile.`,
				);
				return;
			}
			current.attempted.add(candidate.model.provider);
			const signal = ctx.signal ? AbortSignal.any([ctx.signal, current.controller.signal]) : current.controller.signal;
			current.selecting = { model: candidate.model, previous: source };
			const selected = await pi.setModel(candidate.model);
			if (current !== episode) {
				report(ctx, stoppedSelectionMessage(ctx));
				return;
			}
			if (!selected || signal.aborted || !matches(ctx.model, candidate.model)) {
				stop(ctx, stoppedSelectionMessage(ctx));
				return;
			}
			pi.setThinkingLevel(candidate.thinking);
			current.selecting = undefined;
			if (!isCurrent(current, signal)) return;
			current.selection = {
				provider: candidate.model.provider,
				id: candidate.model.id,
				thinking: pi.getThinkingLevel(),
			};
			current.failureEntry = event.messageEntryId;
			current.pending = { signal, requested: false, nativeRetry: nativeRetryable(message, source.contextWindow) };
			const eligible = eligibleSelection(ctx, candidate.model, needsImages);
			if (!isCurrent(current, signal)) return;
			if (!eligible || lastUserEntry(ctx) !== current.userEntry) {
				stop(
					ctx,
					"Provider failover stopped: the selected model or session context changed before recovery could continue.",
				);
				return;
			}
			report(
				ctx,
				`Provider failover selected ${candidate.model.provider}/${candidate.model.id} (${current.selection.thinking}) after ${source.provider} ${reason}; provider success is not yet established.`,
			);
			if (!isCurrent(current, signal)) return;
			return {
				entries: [
					...event.entries,
					{ type: "context_edit" as const, targetId: event.messageEntryId, replacement: null },
				],
			};
		} catch (error) {
			if (current) current.selecting = undefined;
			if (current && current !== episode) return;
			stop(
				ctx,
				error instanceof ModelProfileError
					? `Provider failover stopped: ${error.message}`
					: "Provider failover stopped because destination selection failed.",
			);
			if (!(error instanceof ModelProfileError)) throw error;
		}
	});

	pi.on("agent_before_settle", (event, ctx) => {
		if (!active || excluded() || !episode) return;
		const current = episode;
		const pending = current.pending;
		if (!pending || pending.requested || pending.nativeRetry) return;
		const signal = pending.signal;
		pending.requested = true;
		if (signal.aborted || suppressed || event.outcome !== "error") return;
		const selection = current.selection;
		const eligible =
			selection &&
			eligibleSelection(
				ctx,
				selection,
				requiresImages([...event.context.llmMessages, ...event.context.pendingMessages]),
			);
		if (!isCurrent(current, signal) || suppressed) return;
		if (
			!selection ||
			!eligible ||
			pi.getThinkingLevel() !== selection.thinking ||
			!event.context.canContinue ||
			lastUserEntry(ctx) !== current.userEntry ||
			!ctx.sessionManager.getBranch().some((entry) => entry.id === current.failureEntry)
		) {
			stop(ctx, "Provider failover stopped: the model or retained context is no longer eligible for continuation.");
			return;
		}
		return { continue: true };
	});
}
