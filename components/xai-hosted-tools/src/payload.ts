const XAI_HOSTED_TOOLS = [{ type: "web_search" }, { type: "x_search" }] as const;

interface XaiHostedToolsModelRef {
	provider?: unknown;
	api?: unknown;
}

function isXaiResponsesModel(model: XaiHostedToolsModelRef | null | undefined): boolean {
	return model?.provider === "xai" && model.api === "openai-responses";
}

function toolType(tool: unknown): unknown {
	return typeof tool === "object" && tool !== null ? (tool as { type?: unknown }).type : undefined;
}

/**
 * Add xAI's built-in Responses web_search and x_search tools when the selected
 * model is on that provider and API. Completions-routed xAI models are left unchanged.
 */
export function applyXaiHostedTools(payload: unknown, model: XaiHostedToolsModelRef | null | undefined): unknown {
	if (!isXaiResponsesModel(model) || payload === null || typeof payload !== "object") {
		return undefined;
	}

	const record = payload as Record<string, unknown>;
	if ("tools" in record && !Array.isArray(record.tools)) {
		return undefined;
	}

	const tools = Array.isArray(record.tools) ? [...record.tools] : [];
	const existingTypes = new Set(tools.map(toolType));
	const missing = XAI_HOSTED_TOOLS.filter((tool) => !existingTypes.has(tool.type));
	if (missing.length === 0) {
		return undefined;
	}

	tools.push(...missing.map((tool) => ({ ...tool })));
	return { ...record, tools };
}
