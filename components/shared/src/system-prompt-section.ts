import type { NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";

/**
 * Add a named section to this run's structured system prompt. Pi renders it as `<name>…</name>`.
 * A caller's custom prompt may already contain a rendered section; it is not repeated.
 */
export function setSystemPromptSection(
	options: NormalizedBuildSystemPromptOptions,
	name: string,
	content: string,
): void {
	if (options.customPrompt?.includes(`<${name}>\n`)) return;
	options.sections[name] = content;
}
