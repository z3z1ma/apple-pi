import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

/** Operator sizing policy, not measured benchmark scores. Higher effort can exceed a workload's minimum band. */
export function modelSizingBand(model: string, thinking: ModelThinkingLevel): number {
	const effort = ["off", "minimal", "low", "medium", "high", "xhigh", "max"].indexOf(thinking);
	if (["openai/gpt-6-astra", "anthropic/claude-fable-5-1"].includes(model) && effort >= 3) return 4;
	if (model === "anthropic/claude-opus-5-5") return effort >= 4 ? 4 : effort >= 3 ? 3 : 0;
	if (model === "openai/gpt-6.1-sol" && effort >= 4) return 3;
	if (model === "xai/grok-4.7") return effort >= 4 ? 3 : effort >= 3 ? 2 : effort >= 2 ? 1 : 0;
	if (model === "openai/gpt-6.1-terra" && effort >= 5) return 2;
	if (model === "anthropic/claude-sonnet-5-5" && effort >= 4) return 2;
	if (model === "antigravity/gemini-3.8-flash") return effort === 4 ? 2 : effort === 3 ? 1 : 0;
	if (model === "openai/gpt-6-luna" && effort >= 5) return 1;
	if (model === "anthropic/claude-haiku-5-5" && effort >= 4) return 1;
	return 0;
}

export const PROFILE_SIZING_BANDS: Record<string, number> = {
	deep: 4,
	balanced: 3,
	coding: 3,
	coordination: 3,
	writing: 2,
	"visual-engineering": 2,
	quick: 1,
	routine: 1,
	background: 1,
	pair: 1,
};
