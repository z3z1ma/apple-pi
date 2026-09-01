import { type ExtensionAPI, type ExtensionContext, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { Runtime } from "../runtime.js";

const CUT_POINT_CUSTOM_TYPE = "apple-pi.compaction-cut-point";
const CHARS_PER_TOKEN = 4;

function serializedLength(value: unknown): number {
	try {
		return JSON.stringify(value)?.length ?? 0;
	} catch {
		return 0;
	}
}

/** Mirror Pi's four-characters-per-token estimate without importing private paths. */
function estimateTokens(value: unknown): number {
	return Math.ceil(serializedLength(value) / CHARS_PER_TOKEN);
}

function nativeCompactionSettings(ctx: ExtensionContext) {
	return SettingsManager.create(ctx.cwd, undefined, {
		projectTrusted: ctx.isProjectTrusted(),
	}).getCompactionSettings();
}

function branchTokens(ctx: ExtensionContext): number {
	// Session metadata makes this an intentional overestimate. This path is used
	// only while Pi reports unknown post-compaction usage.
	return estimateTokens(ctx.sessionManager.getBranch());
}

function isCutPointMarker(message: { role?: string; customType?: string }): boolean {
	return message.role === "custom" && message.customType === CUT_POINT_CUSTOM_TYPE;
}

/**
 * Give Pi a valid cut point after an over-budget tool batch. Pi 0.84.4 can
 * otherwise decide that compaction is due but return no preparation or failure
 * event because tool results themselves are not valid cut points.
 */
export function registerOverflowGuard(pi: ExtensionAPI, runtime: Runtime): void {
	pi.on("context", (event) => {
		const messages = event.messages.filter((message) => !isCutPointMarker(message));
		return messages.length === event.messages.length ? undefined : { messages };
	});

	pi.on("turn_end", (event, ctx) => {
		if (event.toolResults.length === 0) return;
		runtime.ensureConfig(ctx.cwd, ctx.isProjectTrusted());
		if (runtime.config.passive) return;

		const model = ctx.model;
		if (!model) return;

		const native = nativeCompactionSettings(ctx);
		if (!native.enabled) return;
		const toolResultTokens = estimateTokens(event.toolResults.map((result) => result.content));
		if (toolResultTokens < native.keepRecentTokens) return;

		const reportedTokens = ctx.getContextUsage()?.tokens;
		const contextTokens =
			typeof reportedTokens === "number" && Number.isFinite(reportedTokens) ? reportedTokens : branchTokens(ctx);
		if (contextTokens < model.contextWindow - native.reserveTokens) return;

		pi.sendMessage(
			{
				customType: CUT_POINT_CUSTOM_TYPE,
				content: [],
				display: false,
			},
			{ deliverAs: "steer", triggerTurn: false },
		);
	});
}
