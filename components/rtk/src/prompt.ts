export const RTK_SYSTEM_PROMPT_SECTION = `# Shell Optimization (RTK)
Shell commands are automatically optimized using RTK to reduce token usage. Command output (such as git status, git diff, test runners, linters, and directory listings) will be filtered and summarized.

When you require exact, unfiltered raw stdout/stderr (such as for precise diff inspections, full stack traces, or byte-for-byte stream verifications), pass verbatim: true in the bash tool call.`;

export function appendRtkSystemPrompt(systemPrompt: string): string {
	if (!systemPrompt) return RTK_SYSTEM_PROMPT_SECTION;
	if (systemPrompt.includes("Shell Optimization (RTK)")) return systemPrompt;
	return `${systemPrompt}\n\n${RTK_SYSTEM_PROMPT_SECTION}`;
}
