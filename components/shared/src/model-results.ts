import type { Usage } from "@earendil-works/pi-ai";

const MAX_TRACE_RESULT_CHARS = 4_000;

/** Text of a Pi tool result; images become a `[mime/type]` placeholder. */
export function resultText(result: any): string {
	if (!Array.isArray(result?.content)) return "";
	return result.content
		.map((part: any) => (part?.type === "text" ? String(part.text ?? "") : `[${part?.mimeType ?? "image"}]`))
		.join("\n");
}

export function traceValue(value: unknown): unknown {
	if (typeof value === "string") return bounded(value, MAX_TRACE_RESULT_CHARS, "trace result").value;
	try {
		const json = JSON.stringify(value);
		if (json && json.length > MAX_TRACE_RESULT_CHARS) {
			return bounded(json, MAX_TRACE_RESULT_CHARS, "trace result").value;
		}
		return value;
	} catch {
		return String(value);
	}
}

export function bounded(value: string, max: number, marker: string): { value: string; truncated: boolean } {
	if (value.length <= max) return { value, truncated: false };
	return {
		value: `${value.slice(0, max)}\n\n[${marker}: truncated from ${value.length.toLocaleString()} characters]`,
		truncated: true,
	};
}

export const aggregateUsage = (usages: Usage[]): Usage => ({
	input: usages.reduce((total, usage) => total + usage.input, 0),
	output: usages.reduce((total, usage) => total + usage.output, 0),
	cacheRead: usages.reduce((total, usage) => total + usage.cacheRead, 0),
	cacheWrite: usages.reduce((total, usage) => total + usage.cacheWrite, 0),
	...(usages.some((usage) => usage.cacheWrite1h !== undefined)
		? { cacheWrite1h: usages.reduce((total, usage) => total + (usage.cacheWrite1h ?? 0), 0) }
		: {}),
	...(usages.some((usage) => usage.reasoning !== undefined)
		? { reasoning: usages.reduce((total, usage) => total + (usage.reasoning ?? 0), 0) }
		: {}),
	totalTokens: usages.reduce((total, usage) => total + usage.totalTokens, 0),
	cost: {
		input: usages.reduce((total, usage) => total + usage.cost.input, 0),
		output: usages.reduce((total, usage) => total + usage.cost.output, 0),
		cacheRead: usages.reduce((total, usage) => total + usage.cost.cacheRead, 0),
		cacheWrite: usages.reduce((total, usage) => total + usage.cost.cacheWrite, 0),
		total: usages.reduce((total, usage) => total + usage.cost.total, 0),
	},
});
