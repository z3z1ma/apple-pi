/** Shared modes.json model and thinking-level resolution. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type ModeSpec = {
	provider?: string;
	modelId?: string;
	thinkingLevel?: string;
};

/**
 * Load a mode from a trusted project's .pi/modes.json, falling back to the
 * user-global ~/.pi/agent/modes.json. Project configuration is never read
 * until Pi has marked the project trusted.
 */
export async function loadModeSpec(
	cwd: string,
	modeName: string,
	projectTrusted: boolean,
): Promise<ModeSpec | undefined> {
	const expandUser = (value: string) => {
		if (value === "~") return os.homedir();
		if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
		return value;
	};
	const agentDir = process.env.PI_CODING_AGENT_DIR
		? expandUser(process.env.PI_CODING_AGENT_DIR)
		: path.join(os.homedir(), ".pi", "agent");
	const candidates = [
		...(projectTrusted ? [path.join(cwd, ".pi", "modes.json")] : []),
		path.join(agentDir, "modes.json"),
	];

	for (const modesPath of candidates) {
		try {
			const parsed = JSON.parse(fs.readFileSync(modesPath, "utf8"));
			const modes = parsed?.modes;
			if (!modes || typeof modes !== "object") continue;
			const entries = modes as Record<string, unknown>;
			// Existing modes are conventionally lowercase while built-in agent names
			// include `Explore` and `Plan`. Exact keys win; only an unambiguous
			// case-insensitive match is accepted as a compatibility fallback.
			const matches = Object.keys(entries).filter((key) => key.toLowerCase() === modeName.toLowerCase());
			const spec = Object.hasOwn(entries, modeName)
				? entries[modeName]
				: matches.length === 1
					? entries[matches[0]]
					: undefined;
			if (!spec || typeof spec !== "object") continue;
			const fields = spec as Record<string, unknown>;
			return {
				provider: typeof fields.provider === "string" ? fields.provider : undefined,
				modelId: typeof fields.modelId === "string" ? fields.modelId : undefined,
				thinkingLevel: typeof fields.thinkingLevel === "string" ? fields.thinkingLevel : undefined,
			};
		} catch {}
	}
	return undefined;
}

/** Resolve mode/model inputs against a caller's active model and thinking level. */
export async function resolveModelAndThinking(
	cwd: string,
	modelRegistry: any,
	currentModel: any,
	currentThinkingLevel: string,
	params: { mode?: string; model?: string },
	projectTrusted: boolean,
): Promise<{ model: any; thinkingLevel: string; explicitModel: boolean }> {
	let model = currentModel;
	let thinkingLevel = currentThinkingLevel;
	let explicitModel = false;

	if (params.mode) {
		const spec = await loadModeSpec(cwd, params.mode, projectTrusted);
		if (spec?.provider && spec.modelId) {
			const resolved = modelRegistry.find(spec.provider, spec.modelId);
			if (resolved) {
				model = resolved;
				explicitModel = true;
			}
		}
		if (spec?.thinkingLevel) thinkingLevel = spec.thinkingLevel;
	}

	if (params.model) {
		const slash = params.model.indexOf("/");
		if (slash > 0) {
			const resolved = modelRegistry.find(params.model.slice(0, slash), params.model.slice(slash + 1));
			if (resolved) {
				model = resolved;
				explicitModel = true;
			}
		}
	}

	return { model, thinkingLevel, explicitModel };
}
