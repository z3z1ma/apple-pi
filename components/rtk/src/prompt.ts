export const RTK_SYSTEM_PROMPT_SECTION = `# Shell Optimization (RTK)
RTK may rewrite bash commands and summarize their output. Pass verbatim: true when the next decision requires exact stdout/stderr, such as a precise diff or full stack trace.`;

export function appendRtkSystemPrompt(systemPrompt: string): string {
	if (!systemPrompt) return RTK_SYSTEM_PROMPT_SECTION;
	if (systemPrompt.includes("Shell Optimization (RTK)")) return systemPrompt;
	return `${systemPrompt}\n\n${RTK_SYSTEM_PROMPT_SECTION}`;
}
