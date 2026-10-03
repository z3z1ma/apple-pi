import type { ServerCompaction } from "./types.js";

type ModelRef = { provider?: unknown; api?: unknown } | null | undefined;

/**
 * How a model compacts on the server, if it can:
 * - `trigger`: an ordinary Responses request ending in a `compaction_trigger` item, as Codex does.
 *   OpenAI API keys reach api.openai.com; Codex sign-in reaches the ChatGPT backend through Pi's Codex adapter.
 * - `endpoint`: xAI's `/responses/compact`.
 * - `anthropic`: Anthropic's summarize request.
 */
export function serverCompactionMethod(model: ModelRef): "trigger" | "endpoint" | "anthropic" | undefined {
	if (model?.provider === "openai" && model.api === "openai-responses") return "trigger";
	if (model?.provider === "openai-codex" && model.api === "openai-codex-responses") return "trigger";
	if (model?.provider === "xai" && model.api === "openai-responses") return "endpoint";
	if (model?.provider === "anthropic" && model.api === "anthropic-messages") return "anthropic";
	return undefined;
}

/** A server compaction result is valid only on the provider and API that produced it. */
export function compactionMatchesModel(compaction: ServerCompaction, model: ModelRef): boolean {
	return compaction.provider === model?.provider && compaction.api === model?.api;
}
